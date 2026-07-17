import { useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';

import { extractNaverCafeCommentAuthors } from '../lib/clipboardCommentParser';
import type { Participant } from '../types';

import './ParticipantSetup.css';

type SetupStep = 'paste' | 'review' | 'edit';

type ParseSummary = {
  total: number;
  replies: number;
};

export interface ParticipantSetupProps {
  initialParticipants: Participant[];
  initialStep?: SetupStep;
  onCancel?: () => void;
  /** Clears the saved roster after the parent has confirmed the destructive action. */
  onClear?: () => void;
  onStart: (participants: Participant[]) => void;
}

function nameKey(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ko-KR');
}

function makeId(index: number) {
  return `participant-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

function dedupeParticipants(items: Participant[]) {
  const seen = new Set<string>();

  return items.flatMap((item) => {
    const name = item.name.replace(/\s+/g, ' ').trim();
    const key = nameKey(name);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ ...item, name }];
  });
}

function parseManualNames(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((name) => name.replace(/^[-•·]\s*/, '').trim())
    .filter((name) => name.length > 0 && name.length <= 40)
    .filter((name) => !/^(?:답글쓰기|더보기|등록|댓글|프로필 사진)$/u.test(name));
}

function steps(current: SetupStep) {
  const order: SetupStep[] = ['paste', 'review', 'edit'];
  return order.indexOf(current) + 1;
}

export default function ParticipantSetup({
  initialParticipants,
  initialStep = 'paste',
  onCancel,
  onClear,
  onStart,
}: ParticipantSetupProps) {
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [pastedPage, setPastedPage] = useState('');
  const [draft, setDraft] = useState<Participant[]>(() => dedupeParticipants(initialParticipants));
  const [manualNames, setManualNames] = useState('');
  const [parseError, setParseError] = useState('');
  const [editorNotice, setEditorNotice] = useState('');
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const richClipboard = useRef('');

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain') || event.clipboardData.getData('text');
    richClipboard.current = event.clipboardData.getData('text/html');
    setPastedPage(text);
    setParseError('');
  };

  const handleParse = () => {
    const source = richClipboard.current || pastedPage;
    if (!source.trim()) {
      setParseError('카페 페이지에서 복사한 내용을 먼저 붙여넣어 주세요.');
      return;
    }

    const candidates = extractNaverCafeCommentAuthors(source);
    const roots = candidates.filter((candidate) => !candidate.reply);
    if (roots.length === 0) {
      setParseError('댓글 작성자를 찾지 못했어요. 원문은 그대로 두었어요. 직접 명단을 만들 수도 있어요.');
      return;
    }

    const nextDraft = dedupeParticipants(
      roots.map((candidate, index) => ({
        id: candidate.id || makeId(index),
        name: candidate.nick,
        weight: 1,
        commentCount: 1,
      })),
    );
    setDraft(nextDraft);
    setSummary({ total: nextDraft.length, replies: candidates.filter((candidate) => candidate.reply).length });
    setParseError('');
    setStep('review');
  };

  const addManualNames = () => {
    const names = parseManualNames(manualNames);
    if (names.length === 0) {
      setEditorNotice('이름을 한 줄에 한 명씩 입력해 주세요.');
      return;
    }

    const before = draft.length;
    const nextDraft = dedupeParticipants([
      ...draft,
      ...names.map((name, index) => ({
        id: makeId(index),
        name,
        weight: 1,
        commentCount: 1,
      })),
    ]);
    setDraft(nextDraft);
    setManualNames('');
    setEditorNotice(`${nextDraft.length - before}명을 명단에 추가했어요.`);
  };

  const addSingleOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    addManualNames();
  };

  const updateName = (id: string, name: string) => {
    setDraft((items) => items.map((item) => (item.id === id ? { ...item, name } : item)));
    setEditorNotice('');
  };

  const removeParticipant = (id: string) => {
    setDraft((items) => items.filter((item) => item.id !== id));
    setEditorNotice('');
  };

  const moveParticipant = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.length) return;
    setDraft((items) => {
      const next = [...items];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const finishSetup = () => {
    const cleaned = dedupeParticipants(draft);
    if (cleaned.length === 0) {
      setEditorNotice('추첨을 시작하려면 참여자가 한 명 이상 필요해요.');
      return;
    }
    onStart(cleaned);
  };

  const currentStep = steps(step);

  return (
    <section className="participant-setup" aria-labelledby="participant-setup-title">
      <header className="participant-setup__header">
        <div>
          <p className="participant-setup__eyebrow">방송 준비</p>
          <h1 id="participant-setup-title">
            {step === 'paste' && '카페 페이지 붙여넣기'}
            {step === 'review' && '댓글 명단 확인'}
            {step === 'edit' && '명단 다듬기'}
          </h1>
        </div>
        {(onClear || onCancel) && (
          <div className="setup-header-actions">
            {onClear && <button className="setup-clear" type="button" onClick={onClear}>명단 비우기</button>}
            {onCancel && (
              <button className="setup-close" type="button" onClick={onCancel} aria-label="명단 편집 닫기">
                ×
              </button>
            )}
          </div>
        )}
      </header>

      <ol className="setup-steps" aria-label="명단 준비 단계">
        {['댓글 찾기', '명단 확인', '필요하면 다듬기'].map((label, index) => (
          <li key={label} className={index + 1 <= currentStep ? 'is-active' : ''} aria-current={index + 1 === currentStep ? 'step' : undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 'paste' && (
        <div className="setup-pane setup-pane--paste">
          <p className="setup-copy">카페 글을 열고 <strong>Ctrl+A → Ctrl+C</strong> 한 뒤 아래에 붙여넣으세요.</p>
          <textarea
            className="setup-textarea"
            value={pastedPage}
            onChange={(event) => {
              richClipboard.current = '';
              setPastedPage(event.target.value);
              setParseError('');
            }}
            onPaste={handlePaste}
            placeholder="카페 페이지 내용 붙여넣기"
            aria-label="카페 페이지 내용"
          />
          {parseError && <p className="setup-message setup-message--error" role="alert">{parseError}</p>}
          <div className="setup-actions">
            <button className="setup-primary" type="button" onClick={handleParse}>댓글 명단 만들기</button>
            <button className="setup-secondary" type="button" onClick={() => setStep('edit')}>이름 직접 입력하기</button>
          </div>
          <p className="setup-privacy">붙여넣은 내용은 이 브라우저 안에서만 확인합니다.</p>
        </div>
      )}

      {step === 'review' && (
        <div className="setup-pane">
          <div className="setup-summary">
            <strong>{summary?.total ?? draft.length}명</strong>
            <span>추첨 명단에 담겼어요{summary && summary.replies > 0 ? ` · 대댓글 ${summary.replies}개는 뺐어요` : ''}</span>
          </div>
          <ol className="setup-review-list">
            {draft.slice(0, 80).map((participant) => <li key={participant.id}>{participant.name}</li>)}
          </ol>
          {draft.length > 80 && <p className="setup-list-note">처음 80명만 표시했어요. 필요하면 다음 화면에서 전체 명단을 다듬을 수 있어요.</p>}
          <div className="setup-actions">
            <button className="setup-primary" type="button" onClick={finishSetup}>이 명단으로 추첨 설정하기</button>
            <button className="setup-secondary" type="button" onClick={() => setStep('edit')}>명단 다듬기</button>
            <button className="setup-link-button" type="button" onClick={() => setStep('paste')}>다시 붙여넣기</button>
          </div>
        </div>
      )}

      {step === 'edit' && (
        <div className="setup-pane">
          <label className="setup-field-label" htmlFor="manual-names">이름을 한 줄에 한 명씩 입력하세요</label>
          <textarea
            id="manual-names"
            className="setup-textarea setup-textarea--short"
            value={manualNames}
            onChange={(event) => {
              setManualNames(event.target.value);
              setEditorNotice('');
            }}
            onKeyDown={addSingleOnEnter}
            placeholder={'티얀키\n사악한고래밥\nSeioon'}
          />
          <div className="setup-inline-action">
            <button className="setup-secondary" type="button" onClick={addManualNames}>명단에 추가</button>
            <span>Enter로도 추가할 수 있어요.</span>
          </div>

          <div className="setup-editor-heading">
            <div>
              <strong>참여자 {draft.length}명</strong>
              <span>순서는 표시용이며 추첨 확률에는 영향을 주지 않아요.</span>
            </div>
            <button className="setup-link-button" type="button" onClick={() => setStep('paste')}>카페 페이지 다시 붙여넣기</button>
          </div>
          <ol className="setup-editor-list">
            {draft.map((participant, index) => (
              <li key={participant.id}>
                <span className="setup-order">{index + 1}</span>
                <input
                  value={participant.name}
                  onChange={(event) => updateName(participant.id, event.target.value)}
                  aria-label={`${index + 1}번 참여자 이름`}
                />
                <div className="setup-row-actions">
                  <button type="button" onClick={() => moveParticipant(index, -1)} disabled={index === 0} aria-label={`${participant.name} 위로`}>↑</button>
                  <button type="button" onClick={() => moveParticipant(index, 1)} disabled={index === draft.length - 1} aria-label={`${participant.name} 아래로`}>↓</button>
                  <button type="button" onClick={() => removeParticipant(participant.id)} aria-label={`${participant.name} 삭제`}>×</button>
                </div>
              </li>
            ))}
          </ol>
          {editorNotice && <p className="setup-message" role="status">{editorNotice}</p>}
          <div className="setup-actions setup-actions--finish">
            <button className="setup-primary" type="button" onClick={finishSetup}>
              {onCancel ? '명단 저장' : '이 명단으로 추첨 설정하기'}
            </button>
            {onCancel && <button className="setup-secondary" type="button" onClick={onCancel}>취소</button>}
          </div>
        </div>
      )}
    </section>
  );
}
