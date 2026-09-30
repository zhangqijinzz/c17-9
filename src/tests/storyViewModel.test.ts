import { describe, expect, it } from 'vitest';
import { createStarterStory } from '../models/story';
import { LocalStoryRepository } from '../repositories/storyRepository';
import { MemoryStorageService } from '../services/storageService';
import { StoryViewModel } from '../viewmodels/storyViewModel';

describe('story view model', () => {
  it('initializes, edits, persists, and restores the main flow', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    expect(viewModel.snapshot.status).toBe('ready');
    viewModel.addCharacter('阿洛', '修复师');
    viewModel.addScene('地下档案室', '他们找到被隐藏的航海日志。');
    const scene = viewModel.selectedScene;
    expect(scene?.title).toBe('地下档案室');
    viewModel.toggleCharacter(scene?.id ?? '', viewModel.snapshot.story?.characters[2]?.id ?? '');
    expect(viewModel.snapshot.stats.characters).toBe(3);

    const restored = new StoryViewModel(repository);
    restored.initialize();
    expect(restored.snapshot.story?.scenes.some((item) => item.title === '地下档案室')).toBe(true);
    expect(restored.snapshot.story?.characters.some((item) => item.name === '阿洛')).toBe(true);
  });

  it('shows recoverable validation feedback and resets corrupt storage', () => {
    const storage = new MemoryStorageService();
    storage.write('{broken');
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    viewModel.addCharacter(' ', '');
    expect(viewModel.snapshot.notice).toContain('至少');
    viewModel.resetProject();
    expect(viewModel.snapshot.story?.id).toBe(createStarterStory().id);
  });

  it('flags the two conflicting scenes after a move and lets the author undo it', () => {
    const viewModel = new StoryViewModel(new LocalStoryRepository(new MemoryStorageService()));
    viewModel.initialize();
    const [harbor, storm] = viewModel.snapshot.story!.scenes.sort((a, b) => a.order - b.order);
    // 风暴前夜依赖来信，却把它上移到来信之前。
    viewModel.moveScene(storm.id, 'up');
    const conflicts = viewModel.dependencyConflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ requiredId: harbor.id, sceneId: storm.id });
    expect(viewModel.canUndoMove).toBe(true);
    expect(viewModel.snapshot.notice).toContain(harbor.title);
    expect(viewModel.snapshot.notice).toContain(storm.title);

    viewModel.undoLastMove();
    const restored = viewModel.snapshot.story!.scenes.sort((a, b) => a.order - b.order);
    expect(restored.map((scene) => scene.id)).toEqual([harbor.id, storm.id]);
    expect(viewModel.dependencyConflicts).toHaveLength(0);
    expect(viewModel.canUndoMove).toBe(false);
  });

  it('lets the author keep the new order by dropping the dependency', () => {
    const viewModel = new StoryViewModel(new LocalStoryRepository(new MemoryStorageService()));
    viewModel.initialize();
    const [harbor, storm] = viewModel.snapshot.story!.scenes.sort((a, b) => a.order - b.order);
    viewModel.moveScene(storm.id, 'up');
    expect(viewModel.dependencyConflicts).toHaveLength(1);
    viewModel.dismissMoveConflict(harbor.id, storm.id);
    expect(viewModel.dependencyConflicts).toHaveLength(0);
    const movedStorm = viewModel.snapshot.story!.scenes.find((scene) => scene.id === storm.id);
    expect(movedStorm?.prerequisiteSceneIds).toEqual([]);
  });

  it('refuses cyclic or duplicate dependencies', () => {
    const viewModel = new StoryViewModel(new LocalStoryRepository(new MemoryStorageService()));
    viewModel.initialize();
    const [harbor, storm] = viewModel.snapshot.story!.scenes.sort((a, b) => a.order - b.order);
    viewModel.selectScene(harbor.id);
    viewModel.addDependency(harbor.id, storm.id);
    expect(viewModel.snapshot.notice).toContain('循环');
    viewModel.addDependency(storm.id, harbor.id);
    expect(viewModel.snapshot.notice).toContain('已经存在');
    expect(viewModel.dependencyConflicts).toHaveLength(0);
  });

  it('removes incoming dependencies and clue references when deleting a scene', () => {
    const storage = new MemoryStorageService();
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    const [harbor, storm] = viewModel.snapshot.story!.scenes.sort((a, b) => a.order - b.order);
    viewModel.selectScene(storm.id);
    viewModel.deleteScene(harbor.id);
    const remaining = viewModel.snapshot.story!.scenes;
    expect(remaining.map((scene) => scene.id)).toEqual([storm.id]);
    expect(remaining[0].order).toBe(1);
    expect(remaining[0].prerequisiteSceneIds).toEqual([]);
    expect(viewModel.snapshot.notice).toContain('解除');
    // 删除后选中态不会停留在已不存在的场景上。
    expect(viewModel.selectedScene?.id).not.toBe(harbor.id);
    // 伏笔对来信的引用也被清空。
    expect(viewModel.snapshot.story!.clues[0].setupSceneId).toBe('');

    const restored = new StoryViewModel(new LocalStoryRepository(storage));
    restored.initialize();
    expect(restored.snapshot.story?.scenes.every((scene) => scene.prerequisiteSceneIds.length === 0)).toBe(true);
  });

  it('opens legacy projects without dependency data and keeps them editable', () => {
    const storage = new MemoryStorageService();
    const legacy = createStarterStory();
    for (const scene of legacy.scenes) {
      delete (scene as unknown as Record<string, unknown>).prerequisiteSceneIds;
    }
    storage.write(JSON.stringify(legacy));
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    expect(viewModel.snapshot.status).toBe('ready');
    expect(viewModel.snapshot.story?.scenes.every((scene) => scene.prerequisiteSceneIds)).toBe(true);

    viewModel.addScene('新的一幕', '老项目照常编辑。');
    expect(viewModel.selectedScene?.title).toBe('新的一幕');
    const [harbor, storm] = viewModel.snapshot.story!.scenes.sort((a, b) => a.order - b.order);
    // 老数据里风暴夜本来就没有前置，上移不会产生冲突。
    viewModel.moveScene(storm.id, 'up');
    expect(viewModel.dependencyConflicts).toHaveLength(0);
    expect(viewModel.canUndoMove).toBe(false);
    // 依赖功能在迁移后的项目上立即可用。
    viewModel.moveScene(storm.id, 'down');
    viewModel.addDependency(storm.id, harbor.id);
    expect(viewModel.snapshot.notice).toContain('前置');
    expect(viewModel.dependencyConflicts).toHaveLength(0);
    expect(viewModel.prerequisitesOf(storm.id).map((scene) => scene.id)).toContain(harbor.id);
  });
});
