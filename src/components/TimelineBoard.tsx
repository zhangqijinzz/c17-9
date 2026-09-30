import { useState } from 'react';
import type { StoryScene } from '../models/story';
import type { StoryViewModel } from '../viewmodels/storyViewModel';

interface TimelineBoardProps { viewModel: StoryViewModel; scenes: StoryScene[]; }

export function TimelineBoard({ viewModel, scenes }: TimelineBoardProps) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const submit = () => { viewModel.addScene(title, summary); setTitle(''); setSummary(''); };
  const story = viewModel.snapshot.story;
  const conflicts = viewModel.dependencyConflicts;
  return (
    <section className="panel timeline-panel">
      <div className="panel-heading timeline-heading"><div><span className="eyebrow">SEQUENCE / 时间结构</span><h2>故事时间线</h2></div><div className="timeline-actions"><span className="hint">前置在后即为冲突 · 点击编辑详情</span><button className="secondary-button" onClick={submit}>＋ 新建场景</button></div></div>
      {viewModel.timelineWarning && <div className="warning-banner">△ {viewModel.timelineWarning}</div>}
      {conflicts.length > 0 && (
        <div className="conflict-banner" role="alert">
          <div className="conflict-banner-head">
            <strong>⚡ {conflicts.length} 条先后被破坏</strong>
            {viewModel.canUndoMove && <button className="conflict-undo" onClick={() => viewModel.undoLastMove()}>↩ 撤销这次移动</button>}
          </div>
          <ul className="conflict-list">
            {conflicts.map((conflict) => (
              <li key={`${conflict.requiredId}->${conflict.sceneId}`}>
                <button className="conflict-scene-link" onClick={() => viewModel.selectScene(conflict.requiredId)}>「{conflict.requiredTitle}」</button>
                <span className="conflict-arrow">应在 →</span>
                <button className="conflict-scene-link" onClick={() => viewModel.selectScene(conflict.sceneId)}>「{conflict.sceneTitle}」</button>
                <span className="conflict-before">之前</span>
                <button className="conflict-drop" title="保留现在的顺序，删除这条前置规则" onClick={() => viewModel.dismissMoveConflict(conflict.requiredId, conflict.sceneId)}>改依赖 ✕</button>
              </li>
            ))}
          </ul>
          <p className="conflict-hint">可以撤销移动恢复顺序，或在场景详情里调整前置依赖。</p>
        </div>
      )}
      <div className="timeline-rail">
        {scenes.map((scene, index) => {
          const selected = story?.selectedSceneId === scene.id;
          const characterCount = story?.characters.filter((character) => scene.characterIds.includes(character.id)).length ?? 0;
          const dependents = viewModel.dependentsOf(scene.id);
          const inConflict = viewModel.conflictNeighborIds(scene.id).has(scene.id);
          const nodeClass = ['scene-node', selected ? 'selected' : '', inConflict ? 'conflict' : ''].filter(Boolean).join(' ');
          return <button className={nodeClass} key={scene.id} onClick={() => viewModel.selectScene(scene.id)}><span className="scene-index">{String(index + 1).padStart(2, '0')}</span><span className="scene-line" /><span className="scene-dot" /><div className="scene-copy"><span className="scene-meta">SCENE {String(index + 1).padStart(2, '0')} · {characterCount} 位人物</span><strong>{scene.title}</strong><span>{scene.summary}</span><div className="scene-tags">{scene.conflict && <em>冲突</em>}{scene.clueIds.length > 0 && <em className="clue-tag">伏笔 {scene.clueIds.length}</em>}{scene.prerequisiteSceneIds.length > 0 && <em className="prereq-tag" title={`前置：${viewModel.prerequisitesOf(scene.id).map((item) => item.title).join('、')}`}>⛓ 前置 {scene.prerequisiteSceneIds.length}</em>}{dependents.length > 0 && <em className="depended-tag" title={`被 ${dependents.map((item) => item.title).join('、')} 依赖，移动前请留意`}>⚓ 被依赖 {dependents.length}</em>}{inConflict && <em className="broken-tag">先后冲突</em>}</div></div></button>;
        })}
        {scenes.length === 0 && <div className="empty-state">时间线还没有场景。创建第一幕，让故事开始移动。</div>}
      </div>
      <div className="create-scene-row"><input aria-label="场景标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="新场景标题，例如：灯塔停电" /><input aria-label="场景摘要" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="一句话写下这一幕发生了什么" /><button onClick={submit}>添加到时间线</button></div>
    </section>
  );
}
