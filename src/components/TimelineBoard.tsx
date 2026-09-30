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
  const sceneById = new Map(story?.scenes.map((scene) => [scene.id, scene]) ?? []);
  const conflictSceneIds = viewModel.getConflictSceneIds();
  return (
    <section className="panel timeline-panel">
      <div className="panel-heading timeline-heading"><div><span className="eyebrow">SEQUENCE / 时间结构</span><h2>故事时间线</h2></div><div className="timeline-actions"><span className="hint">拖动感受节奏 · 点击编辑详情</span><button className="secondary-button" onClick={submit}>＋ 新建场景</button></div></div>
      {viewModel.timelineWarning && <div className="warning-banner">△ {viewModel.timelineWarning}</div>}
      {conflicts.map((conflict) => {
        const scene = sceneById.get(conflict.sceneId);
        const prerequisite = sceneById.get(conflict.prerequisiteSceneId);
        return (
          <div className="dependency-banner" key={conflict.dependencyId} role="alert">
            <div className="dependency-banner-text">
              <strong>前置依赖被破坏：</strong>
              <span>「{prerequisite?.title ?? '未知场景'}」应在「{scene?.title ?? '未知场景'}」之前，现在顺序相反。</span>
            </div>
            <div className="dependency-banner-actions">
              {viewModel.canUndoMove && <button onClick={() => viewModel.undoLastMove()}>撤销这次移动</button>}
              <button onClick={() => viewModel.removeDependency(conflict.dependencyId)}>移除这条依赖</button>
            </div>
          </div>
        );
      })}
      <div className="timeline-rail">
        {scenes.map((scene, index) => {
          const selected = story?.selectedSceneId === scene.id;
          const characterCount = story?.characters.filter((character) => scene.characterIds.includes(character.id)).length ?? 0;
          const dependentCount = viewModel.getDependentCount(scene.id);
          const inConflict = conflictSceneIds.has(scene.id);
          const classNames = ['scene-node'];
          if (selected) classNames.push('selected');
          if (inConflict) classNames.push('conflict');
          return <button className={classNames.join(' ')} key={scene.id} onClick={() => viewModel.selectScene(scene.id)}><span className="scene-index">{String(index + 1).padStart(2, '0')}</span><span className="scene-line" /><span className="scene-dot" /><div className="scene-copy"><span className="scene-meta">SCENE {String(index + 1).padStart(2, '0')} · {characterCount} 位人物</span><strong>{scene.title}</strong><span>{scene.summary}</span><div className="scene-tags">{scene.conflict && <em>冲突</em>}{scene.clueIds.length > 0 && <em className="clue-tag">伏笔 {scene.clueIds.length}</em>}{dependentCount > 0 && <em className="depended-tag" title="这一幕被其他场景作为前置依赖，移动前请留意">⇠ 被 {dependentCount} 幕依赖</em>}{inConflict && <em className="dep-conflict-tag">依赖顺序冲突</em>}</div></div></button>;
        })}
        {scenes.length === 0 && <div className="empty-state">时间线还没有场景。创建第一幕，让故事开始移动。</div>}
      </div>
      <div className="create-scene-row"><input aria-label="场景标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="新场景标题，例如：灯塔停电" /><input aria-label="场景摘要" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="一句话写下这一幕发生了什么" /><button onClick={submit}>添加到时间线</button></div>
    </section>
  );
}
