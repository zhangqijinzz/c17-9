import { describe, expect, it } from 'vitest';
import { createStarterStory, type StoryDocument } from '../models/story';
import {
  findDependencyConflicts,
  getDependentSceneIds,
  getPrerequisiteSceneIds,
  removeDependenciesForScene,
  sanitizeStory,
  wouldCreateCycle,
} from '../models/storyRules';

function storyWithScenes(doc: StoryDocument, count: number): StoryDocument {
  return {
    ...doc,
    scenes: Array.from({ length: count }, (_, index) => ({
      id: `scene-${index + 1}`,
      title: `第${index + 1}幕`,
      order: index + 1,
      summary: '',
      conflict: '',
      characterIds: [],
      clueIds: [],
    })),
  };
}

describe('scene dependency rules', () => {
  it('detects violated dependencies and names both scenes', () => {
    const story = storyWithScenes(createStarterStory(), 3);
    // scene-3 必须在 scene-1 之后（当前满足）；交换二者位置即破坏
    story.dependencies = [{ id: 'dep-1', sceneId: 'scene-3', prerequisiteSceneId: 'scene-1' }];
    expect(findDependencyConflicts(story)).toHaveLength(0);
    story.scenes[0].order = 3;
    story.scenes[2].order = 1;
    const conflicts = findDependencyConflicts(story);
    expect(conflicts).toEqual([{ dependencyId: 'dep-1', sceneId: 'scene-3', prerequisiteSceneId: 'scene-1' }]);
  });

  it('lists prerequisites of a scene and scenes depending on it', () => {
    const story = storyWithScenes(createStarterStory(), 3);
    story.dependencies = [
      { id: 'dep-1', sceneId: 'scene-3', prerequisiteSceneId: 'scene-1' },
      { id: 'dep-2', sceneId: 'scene-3', prerequisiteSceneId: 'scene-2' },
    ];
    expect(getPrerequisiteSceneIds(story, 'scene-3')).toEqual(['scene-1', 'scene-2']);
    expect(getDependentSceneIds(story, 'scene-1')).toEqual(['scene-3']);
  });

  it('prevents cyclic, self, and duplicate dependency edges', () => {
    const story = storyWithScenes(createStarterStory(), 3);
    story.dependencies = [{ id: 'dep-1', sceneId: 'scene-1', prerequisiteSceneId: 'scene-2' }];
    expect(wouldCreateCycle(story, 'scene-2', 'scene-1')).toBe(true);
    expect(wouldCreateCycle(story, 'scene-3', 'scene-1')).toBe(false);
    expect(wouldCreateCycle(story, 'scene-1', 'scene-1')).toBe(true);
  });

  it('removes every edge touching a deleted scene', () => {
    const dependencies = [
      { id: 'dep-1', sceneId: 'scene-2', prerequisiteSceneId: 'scene-1' },
      { id: 'dep-2', sceneId: 'scene-3', prerequisiteSceneId: 'scene-2' },
    ];
    expect(removeDependenciesForScene(dependencies, 'scene-2')).toEqual([]);
  });

  it('opens old projects without dependency data and drops dangling edges', () => {
    const story = storyWithScenes(createStarterStory(), 2);
    const legacyShape = { ...story, dependencies: undefined as unknown as undefined };
    const migrated = sanitizeStory(legacyShape);
    expect(migrated?.dependencies).toEqual([]);

    const withBrokenEdges = sanitizeStory({
      ...story,
      dependencies: [
        { id: 'good', sceneId: 'scene-2', prerequisiteSceneId: 'scene-1' },
        { id: 'dangling', sceneId: 'scene-2', prerequisiteSceneId: 'scene-gone' },
        { id: 'self', sceneId: 'scene-1', prerequisiteSceneId: 'scene-1' },
      ],
    });
    expect(withBrokenEdges?.dependencies.map((dep) => dep.id)).toEqual(['good']);
  });
});
