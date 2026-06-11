/**
 * conversationStore — rolling window of recent voice exchanges.
 *
 * Stores spoken text only (not raw JSON payloads) so Claude can resolve
 * pronouns and references across commands: "unhe sort karo" → previous subject.
 *
 * MAX_TURNS = 3 means up to 3 user + 3 assistant messages (6 total).
 */

const MAX_TURNS = 3;
let _turns = [];

export const conversationStore = {
  addUser(transcript) {
    _push({ role: 'user', content: transcript });
  },

  addAssistant(spokenResponse) {
    if (spokenResponse) _push({ role: 'assistant', content: spokenResponse });
  },

  /**
   * Returns prior turns for Claude's messages array.
   * The current in-flight user message is excluded — it's sent separately.
   */
  getHistory() {
    const copy = [..._turns];
    // Drop the last entry if it's an in-flight user message
    if (copy.length > 0 && copy[copy.length - 1].role === 'user') {
      copy.pop();
    }
    return copy;
  },

  clear() {
    _turns = [];
  },
};

function _push(turn) {
  _turns.push(turn);
  const max = MAX_TURNS * 2;
  if (_turns.length > max) _turns = _turns.slice(-max);
}
