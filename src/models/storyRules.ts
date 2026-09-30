import type { SceneDependency, StoryDocument, StoryScene, StoryStats } from './story';

export interface DependencyConflict {
  dependencyId: string;
  sceneId: string;
  prerequisiteSceneId: string;
}

export function orderedScenes(story: StoryDocument): StoryScene[] {
  return [...story.scenes].sort((a, b) => a.order - b.order);
}

/** 一条依赖被破坏：本应先发生的幕（prerequisite）排到了该幕之后（或重合）。 */
export function findDependencyConflicts(story: StoryDocument): DependencyConflict[] {
  const positionById = new Map(orderedScenes(story).map((scene, index) => [scene.id, index]));
  return story.dependencies.filter((dependency) => {
    const scenePosition = positionById.get(dependency.sceneId);
    const prerequisitePosition = positionById.get(dependency.prerequisiteSceneId);
    if (scenePosition === undefined || prerequisitePosition === undefined) return false;
    return prerequisitePosition >= scenePosition;
  }).map((dependency) => ({
    dependencyId: dependency.id,
    sceneId: dependency.sceneId,
    prerequisiteSceneId: dependency.prerequisiteSceneId,
  }));
}

export function getPrerequisiteSceneIds(story: StoryDocument, sceneId: string): string[] {
  return story.dependencies
    .filter((dependency) => dependency.sceneId === sceneId)
    .map((dependency) => dependency.prerequisiteSceneId);
}

/** 有哪些幕把这一幕当作前置 —— 时间线上用入度提醒作者“动它之前心里有数”。 */
export function getDependentSceneIds(story: StoryDocument, sceneId: string): string[] {
  return story.dependencies
    .filter((dependency) => dependency.prerequisiteSceneId === sceneId)
    .map((dependency) => dependency.sceneId);
}

/** 若再增加 sceneId -> prerequisiteSceneId 这条边会形成环，则返回 true。 */
export function wouldCreateCycle(story: StoryDocument, sceneId: string, prerequisiteSceneId: string): boolean {
  if (sceneId === prerequisiteSceneId) return true;
  const nextById = new Map<string, string[]>();
  for (const dependency of story.dependencies) {
    const next = nextById.get(dependency.sceneId) ?? [];
    next.push(dependency.prerequisiteSceneId);
    nextById.set(dependency.sceneId, next);
  }
  const stack = [prerequisiteSceneId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === sceneId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(nextById.get(current) ?? []));
  }
  return false;
}

export function hasDependency(story: StoryDocument, sceneId: string, prerequisiteSceneId: string): boolean {
  return story.dependencies.some(
    (dependency) => dependency.sceneId === sceneId && dependency.prerequisiteSceneId === prerequisiteSceneId,
  );
}

/** 删除场景时一并清理指向它（或由它发出）的依赖，绝不留下悬空规则。 */
export function removeDependenciesForScene(dependencies: SceneDependency[], sceneId: string): SceneDependency[] {
  return dependencies.filter(
    (dependency) => dependency.sceneId !== sceneId && dependency.prerequisiteSceneId !== sceneId,
  );
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

export function sanitizeStory(input: unknown): StoryDocument | null {
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
  const sceneIds = new Set((candidate.scenes as StoryScene[]).map((scene) => scene.id));
  // 老项目没有依赖数据：补空数组照常编辑；已有数据则剔除指向不存在场景、自指、重复的边。
  const seenEdges = new Set<string>();
  const dependencies = Array.isArray(candidate.dependencies)
    ? (candidate.dependencies as SceneDependency[]).filter((dependency) => {
      if (!dependency || typeof dependency.id !== 'string') return false;
      if (dependency.sceneId === dependency.prerequisiteSceneId) return false;
      if (!sceneIds.has(dependency.sceneId) || !sceneIds.has(dependency.prerequisiteSceneId)) return false;
      const edgeKey = `${dependency.sceneId}->${dependency.prerequisiteSceneId}`;
      if (seenEdges.has(edgeKey)) return false;
      seenEdges.add(edgeKey);
      return true;
    })
    : [];
  return { ...(candidate as StoryDocument), dependencies };
}
