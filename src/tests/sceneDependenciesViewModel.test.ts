import { describe, expect, it } from 'vitest';
import { LocalStoryRepository } from '../repositories/storyRepository';
import { MemoryStorageService } from '../services/storageService';
import { StoryViewModel } from '../viewmodels/storyViewModel';

function makeViewModel(): { viewModel: StoryViewModel; storage: MemoryStorageService } {
  const storage = new MemoryStorageService();
  const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
  viewModel.initialize();
  viewModel.resetProject();
  return { viewModel, storage };
}

describe('dependency-driven reordering', () => {
  it('flags a move that breaks a dependency and supports undo', () => {
    const { viewModel } = makeViewModel();
    const [harbor, storm] = viewModel.visibleScenes;
    // 示例项目：storm 依赖 harbor 在前；把 harbor 下移即破坏
    viewModel.moveScene(harbor.id, 'down');
    expect(viewModel.dependencyConflicts).toHaveLength(1);
    expect(viewModel.dependencyConflicts[0]).toMatchObject({ sceneId: storm.id, prerequisiteSceneId: harbor.id });
    expect(viewModel.canUndoMove).toBe(true);

    viewModel.undoLastMove();
    expect(viewModel.dependencyConflicts).toHaveLength(0);
    expect(viewModel.visibleScenes.map((scene) => scene.id)).toEqual([harbor.id, storm.id]);
  });

  it('adds dependencies, refuses cycles and duplicates, and persists them', () => {
    const { viewModel, storage } = makeViewModel();
    const [harbor, storm] = viewModel.visibleScenes;

    // 反向边会与现有的 storm -> harbor 形成环
    viewModel.addDependency(harbor.id, storm.id);
    expect(viewModel.snapshot.story?.dependencies).toHaveLength(1);
    expect(viewModel.snapshot.notice).toContain('循环');

    viewModel.addDependency(storm.id, harbor.id);
    expect(viewModel.snapshot.notice).toContain('已经存在');

    // 新加第三幕，依赖第一幕
    viewModel.addScene('灯塔停电', '电力中断。');
    const outage = viewModel.visibleScenes[2];
    viewModel.addDependency(outage.id, harbor.id);
    expect(viewModel.snapshot.story?.dependencies).toHaveLength(2);

    const restored = new StoryViewModel(new LocalStoryRepository(storage));
    restored.initialize();
    expect(restored.snapshot.story?.dependencies).toHaveLength(2);
    expect(restored.getPrerequisiteScenes(outage.id).map((scene) => scene.id)).toEqual([harbor.id]);
  });

  it('cascade-cleans dependencies when a scene is deleted', () => {
    const { viewModel } = makeViewModel();
    const [harbor, storm] = viewModel.visibleScenes;
    expect(viewModel.snapshot.story?.dependencies).toHaveLength(1);

    viewModel.deleteScene(storm.id);
    expect(viewModel.snapshot.story?.scenes.some((scene) => scene.id === storm.id)).toBe(false);
    expect(viewModel.snapshot.story?.dependencies).toEqual([]);
    expect(viewModel.dependencyConflicts).toHaveLength(0);

    // 删除剩下的一幕也不会残留
    viewModel.deleteScene(harbor.id);
    expect(viewModel.snapshot.story?.dependencies).toEqual([]);
    expect(viewModel.snapshot.story?.scenes).toHaveLength(0);
  });

  it('keeps editing normally for old projects with no dependency data', () => {
    const storage = new MemoryStorageService();
    const legacy = JSON.parse(JSON.stringify({
      version: 1,
      id: 'legacy-story',
      title: '老项目',
      status: 'draft',
      characters: [],
      scenes: [
        { id: 's1', title: '开端', order: 1, summary: '', conflict: '', characterIds: [], clueIds: [] },
        { id: 's2', title: '发展', order: 2, summary: '', conflict: '', characterIds: [], clueIds: [] },
      ],
      clues: [],
      selectedSceneId: 's1',
      updatedAt: new Date().toISOString(),
    }));
    storage.write(JSON.stringify(legacy));
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    expect(viewModel.snapshot.story?.dependencies).toEqual([]);
    expect(viewModel.dependencyConflicts).toHaveLength(0);

    viewModel.addDependency('s2', 's1');
    expect(viewModel.snapshot.story?.dependencies).toHaveLength(1);
    const restored = new StoryViewModel(new LocalStoryRepository(storage));
    restored.initialize();
    expect(restored.snapshot.story?.dependencies).toHaveLength(1);
  });
});
