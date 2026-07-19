import { useEffect, useRef, useState } from 'react';
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
  /** Mirrors the unsaved draft into the non-committing stage preview. */
  onDraftChange?: (participants: Participant[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
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

function rosterFingerprint(items: readonly Participant[]) {
  return JSON.stringify(dedupeParticipants([...items]).map((item) => ({
    id: item.id,
    name: item.name,
    weight: item.weight,
  })));
}

export default function ParticipantSetup({
  initialParticipants,
  initialStep = 'paste',
  onCancel,
  onClear,
  onDraftChange,
  onDirtyChange,
  onStart,
}: ParticipantSetupProps) {
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [pastedPage, setPastedPage] = useState('');
  const [draft, setDraft] = useState<Participant[]>(() => dedupeParticipants(initialParticipants));
  const [manualNames, setManualNames] = useState('');
  const [parseError, setParseError] = useState('');
  const [editorNotice, setEditorNotice] = useState('');
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const richClipboard = useRef('');
  const initialFingerprint = useRef(rosterFingerprint(initialParticipants));

  useEffect(() => {
    onDraftChange?.(dedupeParticipants(draft));
  }, [draft, onDraftChange]);

  useEffect(() => {
    onDirtyChange?.(
      rosterFingerprint(draft) !== initialFingerprint.current
      || pastedPage.trim().length > 0
      || manualNames.trim().length > 0,
    );
  }, [draft, manualNames, onDirtyChange, pastedPage]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>('[data-setup-initial-focus]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onCancel) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...(rootRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

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
    const addedCount = nextDraft.length - before;
    const skippedCount = names.length - addedCount;
    setEditorNotice(`${addedCount}명을 명단에 추가했어요.${skippedCount > 0 ? ` 중복 ${skippedCount}명은 제외했어요.` : ''}`);
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

  return (
    <section ref={rootRef} className="participant-setup" aria-labelledby="participant-setup-title" onKeyDown={handleDialogKeyDown}>
      <header className="participant-setup__header">
        <div>
          <h1 id="participant-setup-title">
            {step === 'paste' && '명단 추가'}
            {step === 'review' && '명단 확인'}
            {step === 'edit' && (initialParticipants.length > 0 ? '명단 편집' : '직접 입력')}
          </h1>
          <p>{step === 'review' ? `${summary?.total ?? draft.length}명` : `${draft.length}명 저장 전`}</p>
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

      {step === 'paste' && (
        <div className="setup-pane setup-pane--paste">
          <div className="setup-source-tabs" role="group" aria-label="명단 입력 방식">
            <button type="button" aria-pressed="true">카페 댓글</button>
            <button type="button" aria-pressed="false" onClick={() => setStep('edit')}>직접 입력</button>
          </div>
          <p className="setup-copy"><strong>Ctrl+A → Ctrl+C → 붙여넣기</strong></p>
          <textarea
            data-setup-initial-focus
            className="setup-textarea"
            value={pastedPage}
            onChange={(event) => {
              richClipboard.current = '';
              setPastedPage(event.target.value);
              setParseError('');
            }}
            onPaste={handlePaste}
            placeholder="카페 글 전체 붙여넣기"
            aria-label="카페 페이지 내용"
          />
          {parseError && <p className="setup-message setup-message--error" role="alert">{parseError}</p>}
          <div className="setup-actions">
            <button className="setup-primary" type="button" onClick={handleParse}>작성자 확인</button>
          </div>
          <p className="setup-privacy">붙여넣은 내용은 브라우저 안에서만 처리됩니다.</p>
        </div>
      )}

      {step === 'review' && (
        <div className="setup-pane">
          <div className="setup-summary">
            <strong>{summary?.total ?? draft.length}명</strong>
            <span>{summary && summary.replies > 0 ? `대댓글 ${summary.replies}개 제외` : '댓글 작성자'}</span>
          </div>
          <ol className="setup-review-list">
            {draft.slice(0, 80).map((participant) => <li key={participant.id}>{participant.name}</li>)}
          </ol>
          {draft.length > 80 && <p className="setup-list-note">처음 80명 표시 · 전체 {draft.length}명</p>}
          <div className="setup-actions">
            <button data-setup-initial-focus className="setup-primary" type="button" onClick={finishSetup}>이 명단 사용</button>
            <button className="setup-secondary" type="button" onClick={() => setStep('edit')}>명단 수정</button>
            <button className="setup-link-button" type="button" onClick={() => setStep('paste')}>다시 붙여넣기</button>
          </div>
        </div>
      )}

      {step === 'edit' && (
        <div className="setup-pane">
          <div className="setup-source-tabs" role="group" aria-label="명단 입력 방식">
            <button type="button" aria-pressed="false" onClick={() => setStep('paste')}>카페 댓글</button>
            <button type="button" aria-pressed="true">직접 입력</button>
          </div>
          <label className="setup-field-label" htmlFor="manual-names">한 줄에 한 명</label>
          <textarea
            data-setup-initial-focus
            id="manual-names"
            className="setup-textarea setup-textarea--short"
            value={manualNames}
            onChange={(event) => {
              setManualNames(event.target.value);
              setEditorNotice('');
            }}
            placeholder={'티얀키\n사악한고래밥\nSeioon'}
          />
          <div className="setup-inline-action">
            <button className="setup-secondary" type="button" onClick={addManualNames}>명단에 추가</button>
          </div>

          <div className="setup-editor-heading">
            <div>
              <strong>참여자 {draft.length}명</strong>
            </div>
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
              명단 저장
            </button>
            {onCancel && <button className="setup-secondary" type="button" onClick={onCancel}>취소</button>}
          </div>
        </div>
      )}
    </section>
  );
}
