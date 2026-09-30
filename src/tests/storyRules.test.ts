import { describe, expect, it } from 'vitest';
import { createId, createStarterStory } from '../models/story';
import {
  findDependencyConflicts,
  getDependentScenes,
  getStats,
  getTimelineWarning,
  normalizeStoryDocument,
  orderedScenes,
  removeSceneAndDependencies,
  sanitizeStory,
  validateDependency,
  validateName,
} from '../models/storyRules';

describe('story domain rules', () => {
  it('sorts scenes and calculates unresolved clues', () => {
    const story = createStarterStory();
    story.scenes = [...story.scenes].reverse();
    expect(orderedScenes(story).map((scene) => scene.title)).toEqual(['旧港口的来信', '风暴前夜']);
    expect(getStats(story)).toMatchObject({ characters: 2, scenes: 2, clues: 1, unresolvedClues: 1, completion: 80 });
  });

  it('guards invalid names and duplicate timeline orders', () => {
    const story = createStarterStory();
    story.scenes[1].order = story.scenes[0].order;
    expect(validateName(' ')).toBe('至少输入 2 个字');
    expect(getTimelineWarning(story)).toContain('重复');
  });

  it('rejects corrupt persisted documents', () => {
    expect(sanitizeStory('{bad json}')).toBeNull();
    expect(sanitizeStory({ version: 99 })).toBeNull();
    expect(sanitizeStory(createStarterStory())).not.toBeNull();
  });

  it('tracks prerequisite and dependent scenes in both directions', () => {
    const story = createStarterStory();
    const [harbor, storm] = orderedScenes(story);
    // 示例项目里风暴前夜依赖旧港口的来信。
    expect(storm.prerequisiteSceneIds).toEqual([harbor.id]);
    expect(getDependentScenes(story, harbor.id).map((scene) => scene.id)).toEqual([storm.id]);
  });

  it('detects when a prerequisite ends up behind the scene it constrains', () => {
    const story = createStarterStory();
    const [harbor, storm] = orderedScenes(story);
    // 把前置场景移到后面：依赖被破坏，指出的正是这两幕。
    harbor.order = 2;
    storm.order = 1;
    const conflicts = findDependencyConflicts(story);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ requiredId: harbor.id, sceneId: storm.id });
  });

  it('accepts a scene depending on multiple earlier scenes', () => {
    const story = createStarterStory();
    const first = story.scenes[0];
    const third: typeof first = {
      ...first,
      id: createId('scene'),
      title: '灯塔下的真相',
      order: 3,
      characterIds: [],
      clueIds: [],
      prerequisiteSceneIds: [],
    };
    story.scenes.push(third);
    expect(validateDependency(story, third.id, first.id)).toBeNull();
    third.prerequisiteSceneIds = story.scenes.filter((scene) => scene.id !== third.id).map((scene) => scene.id);
    expect(findDependencyConflicts(story)).toHaveLength(0);
  });

  it('forbids self, duplicate and cyclic dependencies', () => {
    const story = createStarterStory();
    const [harbor, storm] = orderedScenes(story);
    expect(validateDependency(story, harbor.id, harbor.id)).toContain('自身');
    expect(validateDependency(story, storm.id, harbor.id)).toContain('已经存在');
    // 让来信反过来依赖风暴夜，会形成环。
    expect(validateDependency(story, harbor.id, storm.id)).toContain('循环');
    expect(validateDependency(story, harbor.id, 'scene-missing')).toContain('不存在');
  });

  it('removes a scene together with every dependency pointing at it', () => {
    const story = createStarterStory();
    const [harbor, storm] = orderedScenes(story);
    const cleaned = removeSceneAndDependencies(story, harbor.id);
    expect(cleaned.scenes.map((scene) => scene.id)).toEqual([storm.id]);
    expect(cleaned.scenes[0].prerequisiteSceneIds).toEqual([]);
    expect(cleaned.scenes[0].order).toBe(1);
  });

  it('migrates old projects that have no dependency data', () => {
    const legacy = createStarterStory();
    delete (legacy.scenes[0] as Partial<typeof legacy.scenes[number]>).prerequisiteSceneIds;
    delete (legacy.scenes[1] as Partial<typeof legacy.scenes[number]>).prerequisiteSceneIds;
    const migrated = normalizeStoryDocument(legacy);
    expect(migrated).not.toBeNull();
    expect(migrated?.scenes.every((scene) => Array.isArray(scene.prerequisiteSceneIds))).toBe(true);
  });

  it('strips duplicate, self and dangling prerequisite references when migrating', () => {
    const story = createStarterStory();
    story.scenes[1].prerequisiteSceneIds = [
      story.scenes[0].id,
      story.scenes[0].id,
      story.scenes[1].id,
      'scene-ghost',
    ];
    const migrated = normalizeStoryDocument(story);
    expect(migrated?.scenes[1].prerequisiteSceneIds).toEqual([story.scenes[0].id]);
  });
});
