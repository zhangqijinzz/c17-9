import { useEffect, useState } from 'react';
import type { StoryCharacter, StoryDocument, StoryScene } from '../models/story';
import type { StoryViewModel } from '../viewmodels/storyViewModel';

interface SceneInspectorProps { viewModel: StoryViewModel; scene: StoryScene | null; characters: StoryCharacter[]; }

export function SceneInspector({ viewModel, scene, characters }: SceneInspectorProps) {
  const [prerequisiteId, setPrerequisiteId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setPrerequisiteId('');
    setConfirmDelete(false);
  }, [scene?.id]);
  if (!scene) return <section className="panel inspector empty-inspector"><span className="eyebrow">INSPECTOR</span><h2>选择一个场景</h2><p>从时间线中选择一幕，开始补充人物、冲突和节奏。</p></section>;
  const story = viewModel.snapshot.story;
  const index = story ? [...story.scenes].sort((a, b) => a.order - b.order).findIndex((item) => item.id === scene.id) : 0;
  const prerequisiteScenes = viewModel.getPrerequisiteScenes(scene.id);
  const dependentScenes = viewModel.getDependentScenes(scene.id);
  const prerequisiteIds = new Set(prerequisiteScenes.map((item) => item.id));
  const candidateScenes = story
    ? [...story.scenes].sort((a, b) => a.order - b.order).filter((item) => item.id !== scene.id && !prerequisiteIds.has(item.id))
    : [];
  const dependencyIdByEdge = new Map(
    story?.dependencies
      .filter((dependency) => dependency.sceneId === scene.id)
      .map((dependency) => [dependency.prerequisiteSceneId, dependency.id]) ?? [],
  );
  return (
    <section className="panel inspector">
      <div className="inspector-top"><div><span className="eyebrow">SCENE {String(index + 1).padStart(2, '0')} / 场景详情</span><h2>{scene.title}</h2></div><span className="edit-state">编辑中</span></div>
      <label>场景标题<input value={scene.title} onChange={(event) => viewModel.updateScene(scene.id, { title: event.target.value })} /></label>
      <label>这一幕发生了什么<textarea value={scene.summary} onChange={(event) => viewModel.updateScene(scene.id, { summary: event.target.value })} rows={3} /></label>
      <label>核心冲突<textarea value={scene.conflict} onChange={(event) => viewModel.updateScene(scene.id, { conflict: event.target.value })} rows={2} placeholder="是什么让人物无法轻易得到想要的东西？" /></label>
      <div className="field-block"><span className="field-label">出场人物</span><div className="person-toggles">{characters.map((character) => <button key={character.id} className={scene.characterIds.includes(character.id) ? `person-toggle selected ${character.color}` : 'person-toggle'} onClick={() => viewModel.toggleCharacter(scene.id, character.id)}><span>{character.name.slice(0, 1)}</span>{character.name}</button>)}</div></div>
      <div className="field-block dependency-block">
        <span className="field-label">前置依赖（这一幕必须发生在它们之后）</span>
        <div className="dependency-list">
          {prerequisiteScenes.map((prerequisite) => {
            const order = story ? orderedIndex(story, prerequisite.id) + 1 : 0;
            return (
              <span className="dependency-chip" key={prerequisite.id}>
                <b>第 {order} 幕</b>{prerequisite.title}
                <button aria-label={`移除对「${prerequisite.title}」的依赖`} onClick={() => {
                  const dependencyId = dependencyIdByEdge.get(prerequisite.id);
                  if (dependencyId) viewModel.removeDependency(dependencyId);
                }}>×</button>
              </span>
            );
          })}
          {prerequisiteScenes.length === 0 && <span className="dependency-empty">还没有前置依赖，可指定必须先发生的幕。</span>}
        </div>
        <div className="dependency-add">
          <select aria-label="选择前置场景" value={prerequisiteId} onChange={(event) => setPrerequisiteId(event.target.value)}>
            <option value="">选择必须先发生的一幕…</option>
            {candidateScenes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
          </select>
          <button disabled={!prerequisiteId} onClick={() => { viewModel.addDependency(scene.id, prerequisiteId); setPrerequisiteId(''); }}>建立依赖</button>
        </div>
        {dependentScenes.length > 0 && <p className="dependent-note">⇠ 被 {dependentScenes.length} 幕依赖：{dependentScenes.map((item) => `「${item.title}」`).join('、')}。删除或后移这一幕会影响它们。</p>}
      </div>
      <div className="order-controls"><span>时间顺序</span><button disabled={index <= 0} onClick={() => viewModel.moveScene(scene.id, 'up')}>↑ 上移</button><button disabled={index >= (story?.scenes.length ?? 1) - 1} onClick={() => viewModel.moveScene(scene.id, 'down')}>↓ 下移</button></div>
      <div className="delete-scene">
        {confirmDelete ? (
          <><span>删除后指向这一幕的依赖会一并移除，确定吗？</span>
            <button className="danger-button" onClick={() => viewModel.deleteScene(scene.id)}>确认删除</button>
            <button onClick={() => setConfirmDelete(false)}>取消</button></>
        ) : (
          <button className="delete-link" onClick={() => setConfirmDelete(true)}>删除这一幕</button>
        )}
      </div>
    </section>
  );
}

function orderedIndex(story: StoryDocument, sceneId: string): number {
  return [...story.scenes].sort((a, b) => a.order - b.order).findIndex((item) => item.id === sceneId);
}
