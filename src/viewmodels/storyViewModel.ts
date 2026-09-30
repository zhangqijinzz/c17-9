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
  describeConflict,
  findDependencyConflicts,
  getDependentScenes,
  getPrerequisiteScenes,
  getStats,
  getTimelineWarning,
  orderedScenes,
  removeSceneAndDependencies,
  validateDependency,
  validateName,
  type DependencyConflict,
} from '../models/storyRules';
import type { StoryRepository } from '../repositories/storyRepository';

export type ViewModelStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

export interface LastMove {
  sceneId: string;
  /** 移动前的场景顺序（id 序列），用于撤销这次移动。 */
  beforeOrder: string[];
}

export interface StoryViewState {
  status: ViewModelStatus;
  story: StoryDocument | null;
  stats: ReturnType<typeof getStats>;
  notice: string;
  error: string;
  search: string;
  activeSection: 'overview' | 'characters' | 'clues';
  /** 最近一次重排的信息；仅当这次重排破坏依赖时存在，供撤销与提示使用。 */
  lastMove: LastMove | null;
}

type Listener = () => void;

export class StoryViewModel {
  private state: StoryViewState = {
    status: 'loading',
    story: null,
    stats: { characters: 0, scenes: 0, clues: 0, unresolvedClues: 0, completion: 0 },
    notice: '',
    error: '',
    search: '',
    activeSection: 'overview',
    lastMove: null,
  };
  private readonly listeners = new Set<Listener>();

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
      this.setState({ status: story.status === 'complete' ? 'completed' : 'ready', story, stats: getStats(story), error: '' });
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
      prerequisiteSceneIds: [],
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
    const beforeScenes = orderedScenes(this.requireStory());
    const index = beforeScenes.findIndex((scene) => scene.id === sceneId);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= beforeScenes.length) return;
    const beforeOrder = beforeScenes.map((scene) => scene.id);
    const reordered = beforeScenes.map((scene) => scene);
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    this.updateStory((story) => ({
      ...story,
      scenes: reordered.map((scene, sceneIndex) => ({ ...scene, order: sceneIndex + 1 })),
    }));
    // 重排后实时检查依赖是否被破坏。
    const conflicts = findDependencyConflicts(this.requireStory());
    if (conflicts.length > 0) {
      const movedScene = reordered[nextIndex];
      this.setState({
        lastMove: { sceneId, beforeOrder },
        notice: `「${movedScene.title}」这次移动破坏了 ${conflicts.length} 条先后：${conflicts.map(describeConflict).join('；')}。`,
      });
    } else {
      this.setState({ lastMove: null, notice: '时间线顺序已更新' });
    }
  }

  /** 撤销最近一次移动，恢复移动前的顺序；冲突状态随之清除。 */
  undoLastMove(): void {
    const { lastMove } = this.state;
    if (!lastMove) return;
    this.updateStory((story) => {
      const byId = new Map(story.scenes.map((scene) => [scene.id, scene]));
      const restoredScenes = lastMove.beforeOrder
        .map((id, index) => {
          const scene = byId.get(id);
          return scene ? { ...scene, order: index + 1 } : null;
        })
        .filter((scene): scene is StoryScene => scene !== null);
      // 撤销期间新建的场景保留在时间线末尾。
      const restoredIds = new Set(lastMove.beforeOrder);
      const newcomers = orderedScenes(story)
        .filter((scene) => !restoredIds.has(scene.id))
        .map((scene, index) => ({ ...scene, order: restoredScenes.length + index + 1 }));
      return { ...story, scenes: [...restoredScenes, ...newcomers] };
    });
    this.setState({ lastMove: null, notice: '已撤销这次移动，时间线恢复原样。' });
  }

  /** 保留移动结果，改为调整依赖：清除一条导致冲突的依赖。 */
  dismissMoveConflict(requiredId: string, sceneId: string): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, prerequisiteSceneIds: scene.prerequisiteSceneIds.filter((id) => id !== requiredId) }
          : scene,
      ),
    }));
    const remaining = findDependencyConflicts(this.requireStory());
    const lastMove = remaining.length > 0 ? this.state.lastMove : null;
    this.setState({
      lastMove,
      notice: remaining.length > 0 ? `还剩 ${remaining.length} 条先后被破坏。` : '依赖已调整，当前顺序不再冲突。',
    });
  }

  addDependency(sceneId: string, prerequisiteId: string): void {
    if (!prerequisiteId) {
      this.setState({ notice: '请先选择一幕作为前置。' });
      return;
    }
    const story = this.requireStory();
    const error = validateDependency(story, sceneId, prerequisiteId);
    if (error) {
      this.setState({ notice: error });
      return;
    }
    this.updateStory((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, prerequisiteSceneIds: [...scene.prerequisiteSceneIds, prerequisiteId] }
          : scene,
      ),
    }));
    const prerequisite = story.scenes.find((scene) => scene.id === prerequisiteId);
    const conflicts = findDependencyConflicts(this.requireStory());
    // 建立依赖本身也是一种「调整依赖」：冲突全部消失时清除待撤销的移动。
    this.setState({
      lastMove: conflicts.length > 0 ? this.state.lastMove : null,
      notice:
        conflicts.length > 0
          ? `已记录「${prerequisite?.title}」为前置，但它目前排在后面，时间线上标为冲突。`
          : `已记录前置：「${prerequisite?.title}」必须在前面。`,
    });
  }

  removeDependency(sceneId: string, prerequisiteId: string): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, prerequisiteSceneIds: scene.prerequisiteSceneIds.filter((id) => id !== prerequisiteId) }
          : scene,
      ),
    }));
    this.setState({ notice: '已移除这条前置依赖。' });
  }

  deleteScene(sceneId: string): void {
    const story = this.requireStory();
    const scene = story.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const dependentTitles = this.dependentsOf(sceneId).map((item) => `「${item.title}」`);
    this.updateStory((current) => {
      const cleaned = removeSceneAndDependencies(current, sceneId);
      // 顺带清理伏笔对该场景的引用，避免伏笔指向不存在的场景。
      const clues = current.clues.map((clue) => ({
        ...clue,
        setupSceneId: clue.setupSceneId === sceneId ? '' : clue.setupSceneId,
        payoffSceneId: clue.payoffSceneId === sceneId ? '' : clue.payoffSceneId,
      }));
      const selectedSceneId =
        current.selectedSceneId === sceneId ? cleaned.scenes[0]?.id ?? '' : current.selectedSceneId;
      return { ...cleaned, clues, selectedSceneId };
    });
    this.setState({
      lastMove: null,
      notice:
        dependentTitles.length > 0
          ? `已删除「${scene.title}」，并解除了 ${dependentTitles.join('、')} 指向它的依赖。`
          : `已删除「${scene.title}」。`,
    });
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
    this.setState({ status: 'ready', story, stats: getStats(story), notice: '已恢复示例项目', error: '', lastMove: null });
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

  /** 当前时间线上所有被破坏的依赖，每次取数都按最新顺序实时计算。 */
  get dependencyConflicts(): DependencyConflict[] {
    const story = this.state.story;
    return story ? findDependencyConflicts(story) : [];
  }

  /** 最近一次移动是否仍可撤销（且当前确实还有冲突）。 */
  get canUndoMove(): boolean {
    return this.state.lastMove !== null && this.dependencyConflicts.length > 0;
  }

  prerequisitesOf(sceneId: string): StoryScene[] {
    const story = this.state.story;
    if (!story) return [];
    return getPrerequisiteScenes(story, sceneId);
  }

  /** 依赖 sceneId 的场景：动它之前作者心里要有数。 */
  dependentsOf(sceneId: string): StoryScene[] {
    const story = this.state.story;
    if (!story) return [];
    return getDependentScenes(story, sceneId);
  }

  /** 某一幕涉及的冲突边，时间线节点据此高亮，返回前置场景的 id。 */
  conflictNeighborIds(sceneId: string): Set<string> {
    const ids = new Set<string>();
    for (const conflict of this.dependencyConflicts) {
      if (conflict.sceneId === sceneId || conflict.requiredId === sceneId) {
        ids.add(conflict.sceneId);
        ids.add(conflict.requiredId);
      }
    }
    return ids;
  }

  private requireStory(): StoryDocument {
    if (!this.state.story) throw new Error('故事尚未初始化');
    return this.state.story;
  }

  private updateStory(updater: (story: StoryDocument) => StoryDocument, showEditing = true): void {
    const story = updater(this.requireStory());
    this.persist(story);
    this.setState({ story, stats: getStats(story), status: showEditing ? 'editing' : this.state.status, error: '' });
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
