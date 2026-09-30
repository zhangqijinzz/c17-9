import type { StoryDocument, StoryScene, StoryStats } from './story';

export function orderedScenes(story: StoryDocument): StoryScene[] {
  return [...story.scenes].sort((a, b) => a.order - b.order);
}

export function getStats(story: StoryDocument): StoryStats {
  const unresolvedClues = story.clues.filter((clue) => clue.payoffSceneId === '').length;
  const totalSignals = story.characters.length + story.scenes.length + story.clues.length;
  const completedSignals = story.characters.length + story.scenes.length + (story.clues.length - unresolvedClues);
  const completion = totalSignals === 0 ? 0 : Math.round((completedSignals / totalSignals) * 100);
  return {
    characters: story.characters.length,
    scenes: story.scenes.length,
    clues: story.clues.length,
    unresolvedClues,
    completion,
  };
}

export function validateName(value: string): string {
  const cleanValue = value.trim();
  return cleanValue.length < 2 ? '至少输入 2 个字' : cleanValue;
}

export function getTimelineWarning(story: StoryDocument): string | null {
  const orders = story.scenes.map((scene) => scene.order);
  return new Set(orders).size !== orders.length ? '时间线存在重复顺序，请重新排列。' : null;
}

/** 一幕的前置场景（依赖的场景），按当前时间线顺序返回。 */
export function getPrerequisiteScenes(story: StoryDocument, sceneId: string): StoryScene[] {
  const scene = story.scenes.find((item) => item.id === sceneId);
  if (!scene) return [];
  return orderedScenes(story).filter((item) => scene.prerequisiteSceneIds.includes(item.id));
}

/** 依赖某一幕的场景，即该幕作为前置被谁依赖着，按当前时间线顺序返回。 */
export function getDependentScenes(story: StoryDocument, sceneId: string): StoryScene[] {
  return orderedScenes(story).filter((scene) => scene.prerequisiteSceneIds.includes(sceneId));
}

export interface DependencyConflict {
  /** 违反先后顺序的依赖边：required 应在 scene 之前。 */
  requiredId: string;
  requiredTitle: string;
  sceneId: string;
  sceneTitle: string;
}

/**
 * 检查依赖关系是否被当前顺序破坏：
 * 只要前置场景排在了依赖它的场景之后，就是一条冲突。
 */
export function findDependencyConflicts(story: StoryDocument): DependencyConflict[] {
  const orderIndex = new Map(orderedScenes(story).map((scene, index) => [scene.id, index]));
  const titleOf = (id: string) => story.scenes.find((scene) => scene.id === id)?.title ?? '已删除场景';
  const conflicts: DependencyConflict[] = [];
  for (const scene of story.scenes) {
    const sceneIndex = orderIndex.get(scene.id);
    if (sceneIndex === undefined) continue;
    for (const prerequisiteId of scene.prerequisiteSceneIds) {
      const prerequisiteIndex = orderIndex.get(prerequisiteId);
      // 前置场景不存在的引用由删除流程与迁移逻辑负责清理，不计入顺序冲突。
      if (prerequisiteIndex !== undefined && prerequisiteIndex > sceneIndex) {
        conflicts.push({
          requiredId: prerequisiteId,
          requiredTitle: titleOf(prerequisiteId),
          sceneId: scene.id,
          sceneTitle: scene.title,
        });
      }
    }
  }
  return conflicts;
}

export function describeConflict(conflict: DependencyConflict): string {
  return `「${conflict.requiredTitle}」应在「${conflict.sceneTitle}」之前`;
}

function reaches(story: StoryDocument, startId: string, targetId: string): boolean {
  const byId = new Map(story.scenes.map((scene) => [scene.id, scene]));
  const stack = [startId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const scene = byId.get(current);
    if (scene) stack.push(...scene.prerequisiteSceneIds);
  }
  return false;
}

/**
 * 给 sceneId 增加 prerequisiteId 前置时是否会形成循环依赖，
 * 或出现自依赖、重复依赖、引用不存在场景等非法情况。
 */
export function validateDependency(story: StoryDocument, sceneId: string, prerequisiteId: string): string | null {
  if (sceneId === prerequisiteId) return '一幕不能依赖自身';
  const scene = story.scenes.find((item) => item.id === sceneId);
  if (!scene || !story.scenes.some((item) => item.id === prerequisiteId)) return '依赖的场景不存在';
  if (scene.prerequisiteSceneIds.includes(prerequisiteId)) return '这两幕的依赖已经存在';
  if (reaches(story, prerequisiteId, sceneId)) return '会形成循环依赖，请调整先后';
  return null;
}

/** 删除场景时一并清掉所有指向它的依赖，避免留下指向不存在场景的规则。 */
export function removeSceneAndDependencies(story: StoryDocument, sceneId: string): StoryDocument {
  const remaining = story.scenes
    .filter((scene) => scene.id !== sceneId)
    .map((scene) => ({
      ...scene,
      prerequisiteSceneIds: scene.prerequisiteSceneIds.filter((id) => id !== sceneId),
    }))
    .sort((a, b) => a.order - b.order)
    .map((scene, index) => ({ ...scene, order: index + 1 }));
  return { ...story, scenes: remaining };
}

/**
 * 迁移旧版文档：老项目没有依赖数据，补上空数组；
 * 同时过滤掉重复引用和指向不存在场景的悬空引用。
 */
export function normalizeStoryDocument(input: unknown): StoryDocument | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Partial<StoryDocument>;
  if (
    candidate.version !== 1 ||
    typeof candidate.id !== 'string' ||
    typeof candidate.title !== 'string' ||
    !Array.isArray(candidate.characters) ||
    !Array.isArray(candidate.scenes) ||
    !Array.isArray(candidate.clues)
  ) {
    return null;
  }
  const sceneIds = new Set(candidate.scenes.map((scene) => scene.id));
  const scenes = candidate.scenes.map((scene) => {
    const rawPrerequisites = Array.isArray(scene.prerequisiteSceneIds) ? scene.prerequisiteSceneIds : [];
    return {
      ...scene,
      prerequisiteSceneIds: [...new Set(rawPrerequisites.filter((id) => id !== scene.id && sceneIds.has(id)))],
    };
  });
  return { ...(candidate as StoryDocument), scenes };
}

export const sanitizeStory = normalizeStoryDocument;
