import assert from 'node:assert/strict';

// Executed inside Chromium; read individual feedback only, not the general decision.
export function readSpeakerFeedback() {
  const headings = [...document.querySelectorAll('h6')].filter(e => e.textContent.trim().toLowerCase() === 'judge comments');
  const entries = [];
  for (const heading of headings) {
    const section = heading.parentElement;
    const labels = [...section.querySelectorAll('p')].filter(p => /^(Proposition|Opposition) Speaker \d+\s*[—–-]\s*/.test(p.textContent.trim()));
    if (!labels.length && section.innerText.trim().toLowerCase() !== 'judge comments') throw new Error('Unrecognized speaker feedback structure');
    for (const label of labels) {
      const sourceHeading = label.textContent.trim();
      const match = sourceHeading.match(/^(Proposition|Opposition) Speaker (\d+)\s*[—–-]\s*(.+)$/);
      if (!match) throw new Error(`Unrecognized feedback heading: ${sourceHeading}`);
      const body = label.nextElementSibling;
      if (!body) throw new Error(`Missing feedback container: ${sourceHeading}`);
      const text = body.innerText.trim();
      if (text) entries.push({ side: match[1] === 'Proposition' ? 'aff' : 'neg', speakerPosition: Number(match[2]), speakerName: match[3].trim(), sourceHeading, text });
    }
  }
  return { sectionPresent: headings.length > 0, judgeName: document.querySelector('[data-testid="ballot-judge-name"]')?.textContent.trim() || null, entries };
}

export function attachSpeakerFeedback(ballot, extracted) {
  const normalize = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const side of Object.values(ballot.sides)) for (const speaker of side.speakers) speaker.feedback = null;
  const seen = new Set();
  for (const note of extracted.entries) {
    const key = `${note.side}:${note.speakerPosition}`;
    assert.ok(!seen.has(key), `Duplicate feedback for ${key}`);
    seen.add(key);
    assert.ok(['aff','neg'].includes(note.side));
    assert.ok(Number.isInteger(note.speakerPosition) && note.speakerPosition > 0);
    const speaker = ballot.sides[note.side]?.speakers[note.speakerPosition - 1];
    assert.ok(speaker, `Feedback has no matching speaker: ${note.sourceHeading}`);
    assert.equal(normalize(speaker.name), normalize(note.speakerName), `Feedback name/position mismatch: ${note.sourceHeading}`);
    assert.ok(note.text.trim());
    speaker.feedback = { ...note };
  }
  ballot.judgeName = extracted.judgeName;
  ballot.feedbackSectionPresent = extracted.sectionPresent;
  ballot.feedbackNoteCount = extracted.entries.length;
}
