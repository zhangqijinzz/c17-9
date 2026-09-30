import { useState } from 'react';
import type { StoryCharacter, StoryScene } from '../models/story';
import type { StoryViewModel } from '../viewmodels/storyViewModel';

interface SceneInspectorProps { viewModel: StoryViewModel; scene: StoryScene | null; characters: StoryCharacter[]; }

export function SceneInspector({ viewModel, scene, characters }: SceneInspectorProps) {
  if (!scene) return <section className="panel inspector empty-inspector"><span className="eyebrow">INSPECTOR</span><h2>选择一个场景</h2><p>从时间线中选择一幕，开始补充人物、冲突和节奏。</p></section>;
  return <InspectorBody key={scene.id} viewModel={viewModel} scene={scene} characters={characters} />;
}

interface InspectorBodyProps { viewModel: StoryViewModel; scene: StoryScene; characters: StoryCharacter[]; }

function InspectorBody({ viewModel, scene, characters }: InspectorBodyProps) {
  const story = viewModel.snapshot.story;
  const allScenes = story ? [...story.scenes].sort((a, b) => a.order - b.order) : [];
  const index = allScenes.findIndex((item) => item.id === scene.id);
  const prerequisites = viewModel.prerequisitesOf(scene.id);
  const dependents = viewModel.dependentsOf(scene.id);
  const candidateScenes = allScenes.filter((item) => item.id !== scene.id && !scene.prerequisiteSceneIds.includes(item.id));
  const [prerequisiteId, setPrerequisiteId] = useState(candidateScenes[0]?.id ?? '');
  const addPrerequisite = () => {
    if (!prerequisiteId) return;
    viewModel.addDependency(scene.id, prerequisiteId);
    const nextCandidates = candidateScenes.filter((item) => item.id !== prerequisiteId);
    setPrerequisiteId(nextCandidates[0]?.id ?? '');
  };
  return (
    <section className="panel inspector">
      <div className="inspector-top"><div><span className="eyebrow">SCENE {String(index + 1).padStart(2, '0')} / 场景详情</span><h2>{scene.title}</h2></div><span className="edit-state">编辑中</span></div>
      <label>场景标题<input value={scene.title} onChange={(event) => viewModel.updateScene(scene.id, { title: event.target.value })} /></label>
      <label>这一幕发生了什么<textarea value={scene.summary} onChange={(event) => viewModel.updateScene(scene.id, { summary: event.target.value })} rows={3} /></label>
      <label>核心冲突<textarea value={scene.conflict} onChange={(event) => viewModel.updateScene(scene.id, { conflict: event.target.value })} rows={2} placeholder="是什么让人物无法轻易得到想要的东西？" /></label>
      <div className="field-block"><span className="field-label">出场人物</span><div className="person-toggles">{characters.map((character) => <button key={character.id} className={scene.characterIds.includes(character.id) ? `person-toggle selected ${character.color}` : 'person-toggle'} onClick={() => viewModel.toggleCharacter(scene.id, character.id)}><span>{character.name.slice(0, 1)}</span>{character.name}</button>)}</div></div>
      <div className="field-block dependency-block">
        <span className="field-label">前置依赖（这一幕必须在它们之后，可依赖多幕）</span>
        <div className="dependency-list">
          {prerequisites.length === 0 && <span className="dependency-empty">还没有前置。作者常把起因写在后文，可以在这里把先后明确下来。</span>}
          {prerequisites.map((prerequisite) => (
            <div className="dependency-row" key={prerequisite.id}>
              <button className="dependency-jump" onClick={() => viewModel.selectScene(prerequisite.id)}>第 {allScenes.findIndex((item) => item.id === prerequisite.id) + 1} 幕 · {prerequisite.title}</button>
              <button className="dependency-remove" onClick={() => viewModel.removeDependency(scene.id, prerequisite.id)} aria-label={`移除前置 ${prerequisite.title}`}>✕</button>
            </div>
          ))}
        </div>
        <div className="dependency-add">
          <select aria-label="选择前置场景" value={prerequisiteId} onChange={(event) => setPrerequisiteId(event.target.value)}>
            {candidateScenes.length === 0 && <option value="">没有可选的场景</option>}
            {candidateScenes.map((item) => <option key={item.id} value={item.id}>第 {allScenes.findIndex((candidate) => candidate.id === item.id) + 1} 幕 · {item.title}</option>)}
          </select>
          <button disabled={candidateScenes.length === 0} onClick={addPrerequisite}>＋ 设为前置</button>
        </div>
        {dependents.length > 0 && (
          <div className="depended-note">⚓ 这一幕被 <b>{dependents.map((item) => `「${item.title}」`).join('、')}</b> 依赖，移动或删除前请留意它们。</div>
        )}
      </div>
      <div className="order-controls"><span>时间顺序</span><button disabled={index <= 0} onClick={() => viewModel.moveScene(scene.id, 'up')}>↑ 上移</button><button disabled={index >= allScenes.length - 1} onClick={() => viewModel.moveScene(scene.id, 'down')}>↓ 下移</button><button className="delete-scene-button" onClick={() => viewModel.deleteScene(scene.id)}>删除此幕</button></div>
    </section>
  );
}
