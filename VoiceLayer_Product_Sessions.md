# VoiceLayer — Product Evolution Sessions
### From demo → real plug-and-play product

---

## WHAT WE'RE BUILDING NOW

Four capabilities that turn a demo into a product:

1. **Conversation Memory** — AI remembers what you said 5 commands ago. "How many are there?" knows what "there" means.
2. **Action Planner** — "Place an order for Rahul, 2 rotis" becomes a 4-step plan the AI executes automatically.
3. **Data Extractor** — "Kitne pending orders hain?" actually reads the number — from the page or the API response — and speaks it back.
4. **Learning Store** — Every successful command gets remembered. After 10 uses, "aaj ke" always maps correctly without hitting Claude.

New files to add:
```
packages/core/src/
├── conversation/
│   └── ConversationManager.ts    ← rolling context window
├── planner/
│   └── ActionPlanner.ts          ← multi-step intent decomposition
├── extractor/
│   └── DataExtractor.ts          ← reads real data from page + API
└── learning/
    └── LearningStore.ts          ← persists + reuses successful mappings
```

---

## SESSION A — Conversation Memory
**Time**: ~40 min | **Goal**: "Woh wala filter laga do" works because AI remembers context

```
VoiceLayer SDK — basic demo working. Now add persistent conversation memory.

Currently every voice command is stateless — the AI has no idea what was said before.
We need a ConversationManager that maintains a rolling window of exchanges and
resolves references like "woh", "there", "those", "same as before".

---

FILE: packages/core/src/conversation/ConversationManager.ts

export interface Turn {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  intent?: {
    action: string
    target: string | null
    speak: string
  }
  pageRoute: string   // route when this turn happened
}

export class ConversationManager {
  private turns: Turn[] = []
  private readonly maxTurns = 20        // rolling window
  private readonly maxAgeMs = 30 * 60 * 1000   // 30 minutes — older turns dropped

  addUserTurn(text: string, pageRoute: string): void
  // Append { role: 'user', content: text, timestamp: Date.now(), pageRoute }
  // Prune: drop turns older than maxAgeMs, keep at most maxTurns total

  addAssistantTurn(speak: string, intent: Turn['intent'], pageRoute: string): void
  // Append { role: 'assistant', content: speak, intent, timestamp: Date.now(), pageRoute }

  getHistory(): { role: 'user' | 'assistant'; content: string }[]
  // Return last 10 turns as simple { role, content } for the AI messages array
  // Do not include turns from a different route unless within last 2 turns
  // (context resets when user navigates to a new page, except recent history)

  getContextSummary(): string
  // Returns a 1-paragraph plain-English summary of recent context for the system prompt:
  // "User is on /orders/today. Recent conversation: they asked for pending orders,
  //  then asked for the count (12), then asked to mark one as delivered."
  // Build from last 5 turns. Return '' if fewer than 2 turns.

  getLastIntent(): Turn['intent'] | null
  // Returns the most recent assistant turn's intent (for resolving "do the same again")

  getLastUserText(): string | null
  // Returns most recent user turn's content

  clear(): void
  // Wipe all turns (called on explicit "new conversation" or session end)

  // Persistence — save/load from sessionStorage (not localStorage — clears on tab close)
  save(): void
  // sessionStorage.setItem('voicelayer_conversation', JSON.stringify(this.turns))

  load(): void
  // Try sessionStorage.getItem → JSON.parse → this.turns = result
  // Wrap in try/catch (storage might be unavailable or corrupted)
}

---

Update packages/core/src/ai/PromptBuilder.ts

Update buildSystemPrompt() to accept an optional contextSummary: string parameter.
If provided, append to system prompt:

"CONVERSATION CONTEXT:
{contextSummary}

Use this context to resolve pronouns and references:
- 'woh', 'that', 'those', 'it' → refer to the most recently mentioned item/action
- 'same', 'again', 'dobara' → repeat the last action
- 'kitne', 'how many' without a subject → count the most recently mentioned data type
- 'wapas', 'back', 'peeche' → undo or reverse the last navigation"

Update buildUserMessage() to use getHistory() as the conversationHistory in the messages array.

---

Update packages/core/src/ai/IntentEngine.ts

understand() now accepts request.conversationHistory (already in IntentRequest type).
Pass it into the messages array BEFORE the current user message.
Also pass contextSummary into buildSystemPrompt().

Update IntentRequest type in ai/types.ts:
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[]
  contextSummary?: string     ← ADD THIS

---

Update packages/core/src/VoiceLayer.ts

Add: private conversation = new ConversationManager()

In init(): call this.conversation.load()

In stopAndProcess():
  // Before calling intentEngine.understand():
  this.conversation.addUserTurn(transcribedText, routeDetector.getCurrentRoute())
  
  const intent = await intentEngine.understand({
    transcribedText,
    pageMap,
    language: config.language,
    networkContext,
    conversationHistory: this.conversation.getHistory(),
    contextSummary: this.conversation.getContextSummary(),
  })
  
  // After getting intent:
  this.conversation.addAssistantTurn(
    intent.speak,
    { action: intent.action, target: intent.target, speak: intent.speak },
    routeDetector.getCurrentRoute()
  )
  this.conversation.save()

---

After writing:
1. Run `npm run build -w packages/core` — fix all errors
2. Test: Open demo. Say "aaj ke orders dikhao" → then say "kitne hain?" 
   The second command should return the count without needing full context restated.
3. Test: Say "pending filter laga do" → then say "woh hata do"
   Second command should remove the filter.
```

---

## SESSION B — Action Planner (Agentic Mode)
**Time**: ~50 min | **Goal**: "Rahul ke liye 2 roti ka order banao" completes a 4-step flow

```
VoiceLayer SDK — conversation memory added. Now add the Action Planner.

Currently the AI returns ONE action per voice command. A command like 
"place an order for Rahul, 2 rotis" requires: navigate → fill name → fill item → submit.
The planner decomposes a complex intent into an ordered sequence of steps and 
executes them one by one, confirming each or auto-executing based on confidence.

---

FILE: packages/core/src/planner/ActionPlanner.ts

export interface ActionStep {
  stepIndex: number
  action: ActionType
  target: string | null
  data?: Record<string, string>
  description: string     // human-readable: "Navigating to new order form"
  speak?: string          // optional speech for this step (only speak on last step)
  waitForMs?: number      // pause after this step before continuing
  waitForMutation?: boolean  // wait for DOM to change before next step
}

export interface ActionPlan {
  goal: string            // original user request
  steps: ActionStep[]
  estimatedDuration: number  // ms
  requiresConfirmation: boolean  // true if plan involves destructive actions (delete, submit)
  confirmationPrompt?: string    // what to ask user before executing
}

export class ActionPlanner {
  constructor(
    private intentEngine: IntentEngine,
    private promptBuilder: PromptBuilder
  ) {}

  async plan(
    userText: string,
    pageMap: PageIntentMap,
    conversationHistory: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<ActionPlan>
  // Send to Claude with a DIFFERENT system prompt (planner prompt, see below)
  // Parse the returned plan JSON
  // Validate each step's action and target exist in pageMap or are reachable
  // Return the ActionPlan

  private buildPlannerSystemPrompt(): string
  // "You are VoiceLayer Planner. Given a user's goal, decompose it into ordered steps.
  //
  //  OUTPUT FORMAT — return ONLY this JSON:
  //  {
  //    "goal": "user's original request",
  //    "steps": [
  //      {
  //        "stepIndex": 0,
  //        "action": "navigate",
  //        "target": "/orders/new",
  //        "description": "Opening new order form",
  //        "waitForMutation": true
  //      },
  //      {
  //        "stepIndex": 1,
  //        "action": "fill_form",
  //        "target": null,
  //        "data": { "#customer-name": "Rahul", "#item": "Roti", "#qty": "2" },
  //        "description": "Filling order details",
  //        "waitForMs": 100
  //      },
  //      {
  //        "stepIndex": 2,
  //        "action": "submit_form",
  //        "target": "form",
  //        "description": "Submitting the order",
  //        "speak": "Order placed for Rahul — 2 rotis."
  //      }
  //    ],
  //    "estimatedDuration": 1500,
  //    "requiresConfirmation": false
  //  }
  //
  //  RULES:
  //  - Only use actions and selectors visible in the page map
  //  - If the first step requires navigating, first step is always navigate
  //  - waitForMutation: true after any navigate or click that opens a modal/form
  //  - Only the LAST step should have a speak value
  //  - If goal involves deleting or submitting irreversible actions, requiresConfirmation: true
  //  - If you cannot build a complete plan, return steps: [] and explain in goal field"

  private buildPlannerUserMessage(userText: string, pageMap: PageIntentMap): string
  // "User goal: {userText}
  //
  //  Current page: {pageMap.currentPage} ({pageMap.currentRoute})
  //  Available actions: {JSON.stringify(pageMap.availableActions.map(a => ({ id: a.id, label: a.label, type: a.type, selector: a.selector, target: a.target })))}
  //  Visible data: {JSON.stringify(pageMap.visibleData)}
  //
  //  Build the minimal step sequence to achieve this goal."

  isComplexIntent(userText: string): boolean
  // Heuristic — returns true if command likely needs multiple steps:
  // - Contains "banao", "create", "add", "submit", "fill", "place", "book"
  // - Contains "aur" (and) suggesting compound action
  // - Contains a name + a quantity + an item (order placement pattern)
  // - Is longer than 8 words
  // Returns false for simple navigation/query commands
}

---

FILE: packages/core/src/planner/PlanExecutor.ts

export class PlanExecutor {
  constructor(
    private actionExecutor: ActionExecutor,
    private domWatcher: DOMWatcher,
    private ttsPlayer: TTSPlayer,
    private overlay: VoiceOverlay
  ) {}

  async execute(plan: ActionPlan, pageMap: PageIntentMap): Promise<PlanResult>
  // 1. If plan.steps is empty → return { success: false, reason: plan.goal }
  //
  // 2. If plan.requiresConfirmation:
  //    await ttsPlayer.speak(plan.confirmationPrompt ?? `Kya main "${plan.goal}" execute karun?`)
  //    // For now, auto-confirm after 2s (voice confirmation UI comes later)
  //    await sleep(2000)
  //
  // 3. For each step in order:
  //    overlay.show(`Step ${step.stepIndex + 1}/${plan.steps.length}`, step.description)
  //    
  //    const result = await actionExecutor.execute(
  //      { action: step.action, target: step.target, data: step.data ?? null, speak: '', confidence: 1, rawResponse: '' },
  //      pageMap
  //    )
  //    
  //    if !result.success: break (partial execution)
  //    
  //    if step.waitForMutation:
  //      try { await domWatcher.waitForChange(['content_added', 'modal_opened'], 2000) }
  //      catch {} // timeout is ok — continue anyway
  //    
  //    if step.waitForMs: await sleep(step.waitForMs)
  //    
  //    if step.speak: await ttsPlayer.speak(step.speak)
  //
  // 4. Return { success: true, stepsCompleted: n, totalSteps: plan.steps.length }

interface PlanResult {
  success: boolean
  stepsCompleted: number
  totalSteps: number
  reason?: string
}

---

Update packages/core/src/VoiceLayer.ts

Add: private planner: ActionPlanner
Add: private planExecutor: PlanExecutor

In stopAndProcess(), after getting transcribedText:

  // Check if this needs a plan
  if (this.planner.isComplexIntent(transcribedText)) {
    // Use planner path
    talkButton.setState('processing')
    overlay.show('Planning...', transcribedText)
    
    const plan = await this.planner.plan(transcribedText, pageMap, this.conversation.getHistory())
    
    if (plan.steps.length === 0) {
      // Fall through to normal single-intent path
    } else {
      const planResult = await this.planExecutor.execute(plan, pageMap)
      // Speak final step's speak text (already handled in PlanExecutor)
      // Add to conversation
      this.conversation.addAssistantTurn(
        plan.steps.at(-1)?.speak ?? `Done — ${plan.goal}`,
        { action: 'plan', target: null, speak: plan.steps.at(-1)?.speak ?? '' },
        routeDetector.getCurrentRoute()
      )
      talkButton.setState('idle')
      overlay.hide()
      return   // skip normal single-intent path
    }
  }
  // ... rest of existing single-intent path

---

After writing:
1. Run `npm run build -w packages/core` — fix all errors
2. Test in demo: Say "Dashboard pe ja ke new order kholo" (go to dashboard and open new order)
   Should execute 2 steps: navigate → click Add Order button
3. Test: Say "aaj ke orders mein se pehla wala deliver mark karo"
   Should plan: navigate to today's orders → find first order → click deliver
4. isComplexIntent test: write 5 vitest unit tests covering true/false cases
```

---

## SESSION C — Data Extractor
**Time**: ~40 min | **Goal**: "Kitne pending hain?" speaks the actual number, not just navigates

```
VoiceLayer SDK — planner added. Now add the Data Extractor.

Currently when a user asks a question ("kitne orders hain?"), the AI either navigates
to a page or says "I don't know." We need it to actually READ the data — from the
current page's visible numbers, or from a recent API response — and speak a real answer.

---

FILE: packages/core/src/extractor/DataExtractor.ts

export interface ExtractedFact {
  key: string           // e.g. "pendingOrders", "totalRevenue"
  value: string | number
  source: 'dom' | 'api_response' | 'page_title'
  selector?: string     // where it was found
  timestamp: number
}

export class DataExtractor {
  private factCache: ExtractedFact[] = []

  extractFromPage(pageMap: PageIntentMap): ExtractedFact[]
  // pageMap.visibleData already has key:value pairs — convert to ExtractedFact[]
  // source = 'dom'
  // Also scan for: tables (extract row count), list items ([role=listitem] count),
  // any element with [data-voice-data] attribute
  // Cache results with timestamp

  extractFromNetworkEvent(event: NetworkEvent): ExtractedFact[]
  // If event.responsePreview is JSON:
  //   Try to parse it
  //   Look for common patterns:
  //     { total: N }, { count: N }, { data: [...] } → data.length
  //     { orders: [...] } → orders.length
  //     { pending: N, delivered: N } → extract each
  //   Return as ExtractedFact[] with source = 'api_response'
  // If not JSON or parse fails → return []

  answerQuestion(question: string, facts: ExtractedFact[]): string | null
  // Simple keyword matching to answer data questions WITHOUT hitting the AI:
  //
  // Normalize question to lowercase.
  // Build keyword→fact mappings:
  //   ['pending', 'baaki', 'left'] → look for fact with key containing 'pending'
  //   ['total', 'kitne', 'count', 'sab'] → look for fact with key containing 'total'|'count'
  //   ['delivered', 'deliver'] → key containing 'delivered'
  //   ['customer', 'grahak'] → key containing 'customer'
  //   ['revenue', 'earning', 'kamai'] → key containing 'revenue'|'earning'
  //
  // If match found → return: "Abhi {value} {key} hain" (Hindi) or "{value} {key}" (English)
  //   Detect language from question: if question contains Hindi words → respond in Hindi
  // If no match → return null (fall through to AI)

  getRecentFacts(maxAgeMs = 60_000): ExtractedFact[]
  // Return facts extracted within the last maxAgeMs
  // Use for passing to AI as additional context
}

---

Update packages/core/src/ai/PromptBuilder.ts

Update buildUserMessage() to accept optional facts: ExtractedFact[]:
If facts provided and non-empty, append:
"Known data on this page:
{facts.map(f => `${f.key}: ${f.value}`).join('\n')}

If the user is asking about any of these values, answer directly from this data.
Do not navigate — just speak the answer with action: speak_only."

---

Update packages/core/src/observer/NetworkObserver.ts

In the fetch patch, after recording a NetworkEvent:
  // Also pass to DataExtractor for parsing
  // (wire this up via a callback registered at install time)

Add: onEvent(cb: (event: NetworkEvent) => void): void
// Register a callback fired for every captured network event (not just during capture sessions)
// This lets DataExtractor listen passively

---

Update packages/core/src/VoiceLayer.ts

Add: private extractor = new DataExtractor()

In init():
  // Listen to all network events passively
  networkObserver.onEvent((event) => {
    const facts = this.extractor.extractFromNetworkEvent(event)
    // facts cached inside extractor automatically
  })

In stopAndProcess(), before calling intentEngine.understand():
  // Try to answer locally first (free, instant)
  const recentFacts = this.extractor.extractFromPage(pageMap)
    .concat(this.extractor.getRecentFacts())
  
  const quickAnswer = this.extractor.answerQuestion(transcribedText, recentFacts)
  if (quickAnswer) {
    // Answer without hitting AI at all
    talkButton.setState('speaking')
    overlay.show('', quickAnswer)
    await ttsPlayer.speak(quickAnswer)
    this.conversation.addAssistantTurn(quickAnswer, { action: 'speak_only', target: null, speak: quickAnswer }, routeDetector.getCurrentRoute())
    talkButton.setState('idle')
    overlay.hide()
    return
  }
  
  // Otherwise pass facts as context to AI
  const intent = await intentEngine.understand({
    transcribedText, pageMap, language: config.language,
    networkContext,
    conversationHistory: this.conversation.getHistory(),
    contextSummary: this.conversation.getContextSummary(),
    extractedFacts: recentFacts,   // ← new field
  })

Add extractedFacts?: ExtractedFact[] to IntentRequest in ai/types.ts.
Pass them to buildUserMessage() in PromptBuilder.

---

After writing:
1. Run `npm run build -w packages/core` — fix errors
2. Test in demo: navigate to Today's Orders page, then say "kitne orders hain?"
   Should answer without navigating, speaking the visible count
3. Test: say "kitne pending hain?" — should speak pending count from visible data
4. Write vitest tests for DataExtractor.answerQuestion() — cover Hindi + English + no match cases
```

---

## SESSION D — Learning Store
**Time**: ~40 min | **Goal**: Repeated commands skip Claude entirely, cost goes to ~zero over time

```
VoiceLayer SDK — extractor added. Now add the Learning Store.

The pattern: user says "aaj ke orders" → goes to /orders/today. After this happens
3 times successfully, VoiceLayer should map "aaj ke orders" → navigate /orders/today
without ever calling Claude. This makes the SDK faster, cheaper, and offline-capable
for learned commands.

---

FILE: packages/core/src/learning/LearningStore.ts

export interface LearnedMapping {
  normalizedText: string    // lowercased, stripped of punctuation
  intent: {
    action: ActionType
    target: string | null
    data: Record<string, string> | null
    speak: string
  }
  successCount: number      // times this mapping worked correctly
  lastUsed: number          // timestamp
  pageRoute: string         // which route this mapping is for (or '*' for any)
  language: 'hi' | 'en' | 'mixed'
}

export class LearningStore {
  private mappings: LearnedMapping[] = []
  private readonly storageKey = 'voicelayer_learned'
  private readonly minConfidenceToUse = 3   // use mapping after 3 successes
  private readonly maxMappings = 200

  load(): void
  // localStorage.getItem(storageKey) → JSON.parse → this.mappings

  save(): void
  // JSON.stringify(this.mappings) → localStorage.setItem

  record(
    userText: string,
    intent: LearnedMapping['intent'],
    pageRoute: string,
    success: boolean
  ): void
  // normalize(userText) → find existing mapping or create new
  // If success: increment successCount, update lastUsed
  // If !success: decrement successCount (min 0) — bad mapping weakens over time
  // Prune: if over maxMappings, remove lowest successCount entries
  // save()

  lookup(userText: string, currentRoute: string): LearnedMapping | null
  // normalize(userText)
  // Find mapping where:
  //   normalizedText matches (exact or fuzzy — see below)
  //   pageRoute === currentRoute OR pageRoute === '*'
  //   successCount >= minConfidenceToUse
  // Fuzzy match: if no exact match, find mapping where normalizedText
  //   has edit distance < 2 from query (handles minor transcription variation)
  //   Use simple Levenshtein distance (implement inline, ~15 lines)
  // Return highest successCount match, or null

  markSuccess(userText: string, pageRoute: string): void
  // Shorthand to increment successCount for a mapping

  markFailure(userText: string, pageRoute: string): void
  // Shorthand to decrement

  private normalize(text: string): string
  // lowercase → remove punctuation → collapse whitespace → trim
  // Also: normalize Hindi variations: 'dikhao'/'dikha'/'dikhado' → 'dikhao'
  //                                   'karo'/'kar'/'kardo' → 'karo'
  //                                   'jao'/'ja'/'jaao' → 'jao'

  private levenshtein(a: string, b: string): number
  // Standard Levenshtein implementation, max distance check 2

  exportMappings(): string
  // JSON.stringify(this.mappings, null, 2)
  // Used for debugging / analytics

  getStats(): { total: number; confident: number; topCommands: string[] }
  // total = this.mappings.length
  // confident = mappings with successCount >= minConfidenceToUse
  // topCommands = top 5 normalizedText by successCount
}

---

Update packages/core/src/VoiceLayer.ts

Add: private learningStore = new LearningStore()

In init(): this.learningStore.load()

In stopAndProcess(), after quickAnswer check and BEFORE calling intentEngine:

  // Check learned mappings
  const learned = this.learningStore.lookup(transcribedText, routeDetector.getCurrentRoute())
  if (learned) {
    // Execute without hitting AI
    overlay.show('', learned.intent.speak)
    const result = await actionExecutor.execute(
      { ...learned.intent, confidence: 1, rawResponse: 'learned' },
      pageMap
    )
    if (result.success) {
      this.learningStore.markSuccess(transcribedText, routeDetector.getCurrentRoute())
      talkButton.setState('speaking')
      await ttsPlayer.speak(learned.intent.speak)
      this.conversation.addAssistantTurn(learned.intent.speak, learned.intent, routeDetector.getCurrentRoute())
      talkButton.setState('idle')
      overlay.hide()
      return
    } else {
      // Mapping failed — fall through to AI, mark as failure
      this.learningStore.markFailure(transcribedText, routeDetector.getCurrentRoute())
    }
  }

  // Call AI as normal...
  const intent = await intentEngine.understand(...)
  const result = await actionExecutor.execute(intent, pageMap)
  
  // After execution, record the outcome for learning:
  this.learningStore.record(
    transcribedText,
    { action: intent.action, target: intent.target, data: intent.data, speak: intent.speak },
    routeDetector.getCurrentRoute(),
    result.success
  )
  this.learningStore.save()

---

Add to VoiceLayerConfig:
  learning?: {
    enabled?: boolean       // default: true
    minConfidence?: number  // override default of 3
    persist?: boolean       // default: true (use localStorage)
  }

If learning.enabled === false: skip all LearningStore calls.

---

After writing:
1. Run `npm run build -w packages/core` — fix errors
2. Open demo. Say "aaj ke orders" 3 times (navigate back between each).
   4th time: watch Network tab — NO call to api.anthropic.com should fire.
3. Add to debug panel: show learning store stats (getStats() output)
4. Write vitest tests for LearningStore:
   - record success 3 times → lookup returns mapping
   - record failure decrements
   - normalize handles Hindi verb variations
   - levenshtein returns correct distance
```

---

## SESSION E — Plug-and-Play Packaging
**Time**: ~45 min | **Goal**: Any dev installs in 5 minutes, zero config needed

```
VoiceLayer SDK — all intelligence layers complete. Now make it truly plug-and-play.

Zero-config mode: if you add the script tag with just an API key, it should
work on ANY web app without any configuration, manual selectors, or page maps.

---

TASK 1: Auto-detection of app framework

FILE: packages/core/src/config/AppDetector.ts

export interface AppProfile {
  framework: 'react' | 'vue' | 'angular' | 'next' | 'vanilla' | 'unknown'
  routerType: 'react-router' | 'vue-router' | 'next-router' | 'hash' | 'history' | 'unknown'
  hasSSR: boolean
  language: 'hi' | 'en' | 'mixed' | 'unknown'   // detected from page content
}

export class AppDetector {
  detect(): AppProfile
  // framework detection:
  //   React: window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]') || window.React
  //   Next.js: window.__NEXT_DATA__
  //   Vue: window.__VUE__ || document.querySelector('#app')?.__vue__
  //   Angular: window.ng || document.querySelector('[ng-version]')
  //
  // routerType:
  //   If React detected + window.location uses clean paths → 'react-router'
  //   If window.location.hash starts with '#/' → 'hash'
  //   else → 'history'
  //
  // language detection:
  //   document.documentElement.lang → if 'hi' or 'hi-IN' → 'hi'
  //   Scan 10 random text nodes from document.body for Hindi Unicode range (0x0900–0x097F)
  //   If > 30% Hindi chars → 'hi', if mixed → 'mixed', else → 'en'

  suggestConfig(profile: AppProfile): Partial<VoiceLayerConfig>
  // Returns a config that works best for the detected profile:
  //   Next.js → language hint, announce defaults
  //   Hindi content detected → language: 'hi'
  //   hash router → patch navigate to use hash
}

---

TASK 2: Zero-config auto-setup

Update VoiceLayer.init() to call AppDetector before anything else:

  const profile = new AppDetector().detect()
  const detectedConfig = new AppDetector().suggestConfig(profile)
  
  // Merge detected config with user config (user config wins):
  this.config = { ...detectedConfig, ...this.config }
  
  // Auto-patch router if needed:
  if (profile.routerType === 'hash') {
    // Override navigate in DOMInteractor to use window.location.hash
    this.interactor.setNavigateStrategy('hash')
  }
  if (profile.framework === 'next') {
    // Next.js: listen for Next.js router events instead of popstate
    // window.next?.router?.events?.on('routeChangeComplete', ...)
  }

---

TASK 3: Smart selector fallback

Update DOMInteractor.click() and fillInput() — when querySelector(selector) returns null,
instead of immediately throwing, try these fallbacks in order:

  1. Try selector without nth-child: strip :nth-child(...) from selector
  2. Try by aria-label: querySelector(`[aria-label="${label}"]`) where label comes from pageMap
  3. Try by text content: find any button/a whose textContent.trim() === original label
  4. Try by data-voice-label: querySelector(`[data-voice-label="${label}"]`)
  5. THEN throw ELEMENT_NOT_FOUND

Add to DOMInteractor:
  private findElementWithFallback(selector: string, label?: string): Element
  // Implements the 5-step fallback above

---

TASK 4: Installable npm package

Update packages/core/package.json:
{
  "name": "voicelayer-sdk",
  "version": "0.2.0",
  "description": "Make any web app voice-controlled in one script tag",
  "main": "dist/voicelayer.umd.js",
  "module": "dist/voicelayer.js",
  "types": "dist/voicelayer.d.ts",
  "unpkg": "dist/voicelayer.iife.js",
  "jsdelivr": "dist/voicelayer.iife.js",
  "exports": {
    ".": {
      "import": "./dist/voicelayer.js",
      "require": "./dist/voicelayer.umd.js",
      "types": "./dist/voicelayer.d.ts"
    }
  },
  "files": ["dist", "README.md"],
  "keywords": ["voice", "sdk", "web", "ai", "hindi", "accessibility"],
  "sideEffects": false
}

---

TASK 5: README.md at repo root

Write a clean README with:

# VoiceLayer SDK
Make any web app voice-controlled in one script tag. Supports Hindi, English, Hinglish.

## Install
### Script tag (zero config)
```html
<script
  src="https://unpkg.com/voicelayer-sdk/dist/voicelayer.iife.js"
  data-anthropic-key="YOUR_KEY"
  data-openai-key="YOUR_KEY"
></script>
```
Done. An orange mic button appears. Users can speak to your app.

### npm
```bash
npm install voicelayer-sdk
```
```javascript
import { VoiceLayer } from 'voicelayer-sdk'
const vl = new VoiceLayer({ anthropicKey: '...', openaiKey: '...' })
vl.init()
```

## Optional: Better navigation (React Router)
[VoiceLayerBridge component code from integration guide]

## Optional: Label key elements
[data-voice-label explanation]

## How it works
[4-line explanation: mic → Whisper → Claude → action]

## Cost
[pricing table from project plan]

---

TASK 6: Final build and size check

Run `npm run build -w packages/core`
Check: dist/voicelayer.iife.js must be < 150KB unzipped
Run: `gzip -c packages/core/dist/voicelayer.iife.js | wc -c` → target < 50KB gzipped

If over: open vite.config.ts and add to build.rollupOptions:
  treeshake: true
  external: [] (nothing external — it's a self-contained bundle)
  manualChunks: undefined

Run `npm test -w packages/core` — all pass
Run `npm pack --dry-run -w packages/core` — verify included files look right
```

---

## UPDATED FILE STRUCTURE (after all sessions)

```
packages/core/src/
├── index.ts
├── VoiceLayer.ts               ← orchestrator (updated each session)
├── errors.ts
├── audio/
│   ├── AudioCapture.ts
│   ├── Transcriber.ts
│   └── TTSPlayer.ts
├── scanner/
│   ├── DOMScanner.ts
│   ├── IntentMapper.ts
│   ├── RouteDetector.ts
│   └── types.ts
├── ai/
│   ├── IntentEngine.ts
│   ├── PromptBuilder.ts
│   └── ResponseParser.ts
├── executor/
│   ├── ActionExecutor.ts
│   ├── DOMInteractor.ts
│   └── FormFiller.ts
├── observer/
│   ├── NetworkObserver.ts
│   └── MutationObserver.ts
├── ui/
│   ├── TalkButton.ts
│   ├── VoiceOverlay.ts
│   ├── AnnouncerBar.ts
│   └── styles.css
├── conversation/
│   └── ConversationManager.ts  ← SESSION A (new)
├── planner/
│   ├── ActionPlanner.ts        ← SESSION B (new)
│   └── PlanExecutor.ts         ← SESSION B (new)
├── extractor/
│   └── DataExtractor.ts        ← SESSION C (new)
├── learning/
│   └── LearningStore.ts        ← SESSION D (new)
└── config/
    ├── AppDetector.ts          ← SESSION E (new)
    ├── VoiceLayerConfig.ts
    └── defaults.ts
```

---

## WHAT EACH SESSION GIVES YOU

| Session | Feature | User experience |
|---------|---------|----------------|
| A — Conversation | Memory | "Woh wala" and "kitne hain?" work naturally |
| B — Planner | Multi-step | "Rahul ke liye order banao" runs 4 steps automatically |
| C — Extractor | Data reading | "Kitne pending?" answered from page data, no navigation |
| D — Learning | Gets smarter | After 3 uses, common commands skip AI entirely |
| E — Packaging | Plug-and-play | 1 script tag, zero config, works on any app |

## RUN ORDER
```
▶ Session A — Conversation Memory    ← start here
⬜ Session B — Action Planner
⬜ Session C — Data Extractor
⬜ Session D — Learning Store
⬜ Session E — Packaging
```
