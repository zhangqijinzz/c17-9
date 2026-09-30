import {
  characterColors,
  createId,
  createStarterStory,
  type StoryCharacter,
  type StoryClue,
  type StoryDocument,
  type StoryScene,
} from '../models/story';
import {
  findDependencyConflicts,
  getDependentSceneIds,
  getPrerequisiteSceneIds,
  getStats,
  getTimelineWarning,
  hasDependency,
  orderedScenes,
  removeDependenciesForScene,
  validateName,
  wouldCreateCycle,
  type DependencyConflict,
} from '../models/storyRules';
import type { StoryRepository } from '../repositories/storyRepository';

export type ViewModelStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

export interface StoryViewState {
  status: ViewModelStatus;
  story: StoryDocument | null;
  stats: ReturnType<typeof getStats>;
  notice: string;
  error: string;
  search: string;
  activeSection: 'overview' | 'characters' | 'clues';
  dependencyConflicts: DependencyConflict[];
}

type Listener = () => void;

interface SceneMove {
  sceneId: string;
  previousOrders: Record<string, number>;
}

export class StoryViewModel {
  private state: StoryViewState = {
    status: 'loading',
    story: null,
    stats: { characters: 0, scenes: 0, clues: 0, unresolvedClues: 0, completion: 0 },
    notice: '',
    error: '',
    search: '',
    activeSection: 'overview',
    dependencyConflicts: [],
  };
  private readonly listeners = new Set<Listener>();
  private lastMove: SceneMove | null = null;

  constructor(private readonly repository: StoryRepository) {}

  get snapshot(): StoryViewState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize(): void {
    try {
      const story = this.repository.load();
      this.lastMove = null;
      this.setState({
        status: story.status === 'complete' ? 'completed' : 'ready',
        story,
        stats: getStats(story),
        dependencyConflicts: findDependencyConflicts(story),
        error: '',
      });
    } catch {
      this.setState({ status: 'error', error: '故事读取失败，请重置为示例项目。' });
    }
  }

  setSearch(search: string): void {
    this.setState({ search });
  }

  setSection(activeSection: StoryViewState['activeSection']): void {
    this.setState({ activeSection });
  }

  selectScene(sceneId: string): void {
    this.updateStory((story) => ({ ...story, selectedSceneId: sceneId }));
  }

  addCharacter(name: string, role: string): void {
    const cleanName = validateName(name);
    if (cleanName === '至少输入 2 个字') {
      this.setState({ notice: cleanName });
      return;
    }
    const story = this.requireStory();
    const character: StoryCharacter = {
      id: createId('character'),
      name: cleanName,
      role: role.trim() || '待定义角色',
      color: characterColors[story.characters.length % characterColors.length],
    };
    this.updateStory((current) => ({ ...current, characters: [...current.characters, character] }));
    this.setState({ notice: `已加入人物「${character.name}」` });
  }

  addScene(title: string, summary: string): void {
    const cleanTitle = validateName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    const story = this.requireStory();
    const scene: StoryScene = {
      id: createId('scene'),
      title: cleanTitle,
      order: story.scenes.length + 1,
      summary: summary.trim() || '还没有写下这一幕发生了什么。',
      conflict: '',
      characterIds: [],
      clueIds: [],
    };
    this.updateStory((current) => ({ ...current, scenes: [...current.scenes, scene], selectedSceneId: scene.id }));
    this.setState({ notice: `已创建场景「${scene.title}」` });
  }

  updateScene(sceneId: string, patch: Partial<Pick<StoryScene, 'title' | 'summary' | 'conflict'>>): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
    }), false);
  }

  toggleCharacter(sceneId: string, characterId: string): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        const hasCharacter = scene.characterIds.includes(characterId);
        return { ...scene, characterIds: hasCharacter ? scene.characterIds.filter((id) => id !== characterId) : [...scene.characterIds, characterId] };
      }),
    }));
  }

  moveScene(sceneId: string, direction: 'up' | 'down'): void {
    const scenes = orderedScenes(this.requireStory());
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= scenes.length) return;
    const previousOrders = Object.fromEntries(scenes.map((scene) => [scene.id, scene.order]));
    [scenes[index], scenes[nextIndex]] = [scenes[nextIndex], scenes[index]];
    this.updateStory((story) => ({ ...story, scenes: scenes.map((scene, sceneIndex) => ({ ...scene, order: sceneIndex + 1 })) }));
    const conflicts = findDependencyConflicts(this.requireStory());
    this.lastMove = { sceneId, previousOrders };
    this.setState({
      dependencyConflicts: conflicts,
      notice: conflicts.length > 0 ? '这次移动破坏了前置依赖，可以撤销或调整依赖' : '时间线顺序已更新',
    });
  }

  undoLastMove(): void {
    if (!this.lastMove) return;
    const snapshot = this.lastMove;
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) =>
        snapshot.previousOrders[scene.id] === undefined ? scene : { ...scene, order: snapshot.previousOrders[scene.id] },
      ),
    }));
    this.lastMove = null;
    this.setState({ dependencyConflicts: findDependencyConflicts(this.requireStory()), notice: '已撤销这次移动，时间线恢复原样' });
  }

  get canUndoMove(): boolean {
    return this.lastMove !== null;
  }

  addDependency(sceneId: string, prerequisiteSceneId: string): void {
    if (!prerequisiteSceneId) {
      this.setState({ notice: '请先选择要前置的那一幕' });
      return;
    }
    const story = this.requireStory();
    if (sceneId === prerequisiteSceneId) {
      this.setState({ notice: '一幕不能依赖它自己' });
      return;
    }
    if (hasDependency(story, sceneId, prerequisiteSceneId)) {
      this.setState({ notice: '这条前置依赖已经存在' });
      return;
    }
    if (wouldCreateCycle(story, sceneId, prerequisiteSceneId)) {
      this.setState({ notice: '不能建立这条依赖：两幕会形成循环前置' });
      return;
    }
    const prerequisiteTitle = story.scenes.find((scene) => scene.id === prerequisiteSceneId)?.title ?? '';
    this.updateStory((current) => ({
      ...current,
      dependencies: [...current.dependencies, { id: createId('dependency'), sceneId, prerequisiteSceneId }],
    }));
    this.lastMove = null;
    this.setState({ dependencyConflicts: findDependencyConflicts(this.requireStory()), notice: `已记录：这一幕必须发生在「${prerequisiteTitle}」之后` });
  }

  removeDependency(dependencyId: string): void {
    this.updateStory((story) => ({
      ...story,
      dependencies: story.dependencies.filter((dependency) => dependency.id !== dependencyId),
    }));
    this.lastMove = null;
    this.setState({ dependencyConflicts: findDependencyConflicts(this.requireStory()), notice: '前置依赖已移除' });
  }

  deleteScene(sceneId: string): void {
    const story = this.requireStory();
    const target = story.scenes.find((scene) => scene.id === sceneId);
    const remaining = orderedScenes({ ...story, scenes: story.scenes.filter((scene) => scene.id !== sceneId) });
    const removedClueIds = new Set(
      story.clues
        .filter((clue) => clue.setupSceneId === sceneId || clue.payoffSceneId === sceneId)
        .map((clue) => clue.id),
    );
    this.updateStory((current) => ({
      ...current,
      scenes: remaining.map((scene, index) => ({
        ...scene,
        order: index + 1,
        clueIds: scene.clueIds.filter((clueId) => !removedClueIds.has(clueId)),
      })),
      clues: current.clues.filter((clue) => !removedClueIds.has(clue.id)),
      dependencies: removeDependenciesForScene(current.dependencies, sceneId),
      selectedSceneId: current.selectedSceneId === sceneId ? (remaining[0]?.id ?? '') : current.selectedSceneId,
    }));
    this.lastMove = null;
    this.setState({ dependencyConflicts: findDependencyConflicts(this.requireStory()), notice: `已删除场景「${target?.title ?? ''}」，相关依赖一并清理` });
  }

  addClue(title: string, setupSceneId: string, payoffSceneId: string): void {
    const cleanTitle = validateName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    if (!setupSceneId) {
      this.setState({ notice: '请先选择伏笔埋下的场景' });
      return;
    }
    const clue: StoryClue = { id: createId('clue'), title: cleanTitle, setupSceneId, payoffSceneId };
    this.updateStory((story) => ({
      ...story,
      clues: [...story.clues, clue],
      scenes: story.scenes.map((scene) => scene.id === setupSceneId ? { ...scene, clueIds: [...scene.clueIds, clue.id] } : scene),
    }));
    this.setState({ notice: payoffSceneId ? '伏笔关系已建立' : '伏笔已记录，等待回收' });
  }

  completeProject(): void {
    this.updateStory((story) => ({ ...story, status: 'complete' }));
    this.setState({ status: 'completed', notice: '项目已标记为完成，仍可继续编辑' });
  }

  resetProject(): void {
    const story = createStarterStory();
    this.persist(story);
    this.lastMove = null;
    this.setState({
      status: 'ready',
      story,
      stats: getStats(story),
      notice: '已恢复示例项目',
      error: '',
      dependencyConflicts: findDependencyConflicts(story),
    });
  }

  get visibleCharacters(): StoryCharacter[] {
    const story = this.requireStory();
    const keyword = this.state.search.trim().toLowerCase();
    return story.characters.filter((character) => `${character.name}${character.role}`.toLowerCase().includes(keyword));
  }

  get visibleScenes(): StoryScene[] {
    const story = this.requireStory();
    const keyword = this.state.search.trim().toLowerCase();
    return orderedScenes(story).filter((scene) => `${scene.title}${scene.summary}${scene.conflict}`.toLowerCase().includes(keyword));
  }

  get selectedScene(): StoryScene | null {
    const story = this.state.story;
    return story?.scenes.find((scene) => scene.id === story.selectedSceneId) ?? null;
  }

  get timelineWarning(): string | null {
    const story = this.state.story;
    return story ? getTimelineWarning(story) : null;
  }

  get dependencyConflicts(): DependencyConflict[] {
    return this.state.dependencyConflicts;
  }

  getPrerequisiteScenes(sceneId: string): StoryScene[] {
    const story = this.requireStory();
    const byId = new Map(story.scenes.map((scene) => [scene.id, scene]));
    return getPrerequisiteSceneIds(story, sceneId)
      .map((prerequisiteId) => byId.get(prerequisiteId))
      .filter((scene): scene is StoryScene => Boolean(scene));
  }

  getDependentScenes(sceneId: string): StoryScene[] {
    const story = this.requireStory();
    const byId = new Map(story.scenes.map((scene) => [scene.id, scene]));
    return getDependentSceneIds(story, sceneId)
      .map((dependentId) => byId.get(dependentId))
      .filter((scene): scene is StoryScene => Boolean(scene));
  }

  /** 时间线视图用：每一幕被多少别的幕依赖（入度）。 */
  getDependentCount(sceneId: string): number {
    return getDependentSceneIds(this.requireStory(), sceneId).length;
  }

  getConflictSceneIds(): Set<string> {
    return new Set(this.state.dependencyConflicts.flatMap((conflict) => [conflict.sceneId, conflict.prerequisiteSceneId]));
  }

  private requireStory(): StoryDocument {
    if (!this.state.story) throw new Error('故事尚未初始化');
    return this.state.story;
  }

  private updateStory(updater: (story: StoryDocument) => StoryDocument, showEditing = true): void {
    const story = updater(this.requireStory());
    this.persist(story);
    this.setState({
      story,
      stats: getStats(story),
      status: showEditing ? 'editing' : this.state.status,
      error: '',
      dependencyConflicts: findDependencyConflicts(story),
    });
  }

  private persist(story: StoryDocument): void {
    try {
      this.repository.save({ ...story, updatedAt: new Date().toISOString() });
    } catch {
      this.setState({ status: 'error', error: '保存失败，但当前编辑仍保留在页面中。' });
    }
  }

  private setState(patch: Partial<StoryViewState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}
