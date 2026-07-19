import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ParticipantSetup from './ParticipantSetup';

describe('ParticipantSetup direct entry', () => {
  it('shows the five Retto examples and the Shift+Enter batch shortcut', () => {
    const markup = renderToStaticMarkup(
      <ParticipantSetup
        initialParticipants={[]}
        initialStep="edit"
        onStart={() => undefined}
      />,
    );

    expect(markup).toContain('Shift+Enter로 한 번에 추가');
    expect(markup).toContain('aria-keyshortcuts="Shift+Enter"');
    expect(markup).toContain('아모레또\n유레카\n세나\n코코\n망징이');
  });
});
