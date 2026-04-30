import { describe, it, expect } from "vitest";
import { normalizeImportedReviewText } from "./ReviewBlockFormat";
import { SuggestionParser } from "./SuggestionParser";
import { ReviewerDirectory } from "../state/ReviewerDirectory";

describe("user paste from LLM — full content", () => {
  it("parses every edit", () => {
    const paste = `Template: Editorialist advanced
TemplateYear: 2026
SupportedOperations: Edit, Move, Cut, Condense
Reviewer: GPT-5.4
ReviewerType: ai-editor
Provider: OpenAI
Model: GPT-5.4

=== MEMO ===
SceneId: scn_eb08b7ef
Strengths:
This revision is much tighter. The fatigue progression is clearer, the crash mechanics are easier to follow, and the scene now has better forward pressure. The strongest opportunity is to make the crash feel less like a random equipment failure and more like the first visible rupture in the hidden IT system.

Issues:
Add only a few surgical hints. The scene should not explain AEA's failure yet. It should create the feeling that a background intelligence, safety layer, or referee has vanished. The key tonal move is absence: no correction, no rescue, no reliable voice, no system catching her.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: She hasn't seen any sign of other contestants in hours—maybe a day.
Revised: She hasn't seen any sign of other contestants in hours—maybe a day. That isn't how this stage is supposed to unfold.
Why: Adds unease without exposition. Shail knows the Tourney rhythm well enough to sense a deviation.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: Another camera caught her and now follows with a slight wobble. A wingman, or perhaps a spy.
Revised: Another camera caught her and now follows with a slight wobble. A wingman. Or something else now.
Why: Keeps the suspicion but makes it less on-the-nose and more unsettling.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: Her mind is mush. Hey? What's my name? Crackerjack! Rearview Runner! That's my name.
Revised: Her mind is mush. Hey? What's my name? Crackerjack! Rearview Runner! That's my name. The HUD should have corrected her by now.
Why: Links fatigue to subtle system slippage. The missing correction becomes an early sign that support systems are failing.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: At first glance, as she periscopes her head around, she sees nothing amiss. The blue sky looks normal.
Revised: At first glance, as she periscopes her head around, she sees nothing amiss. The blue sky looks normal. That is wrong. There should be something.
Why: Gives Shail an instinctive recognition that the event does not match known failure patterns.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: At the same time, the skullcap HUD blinks out. The clear plasma cells embedded in the wings suddenly burst.
Revised: At the same instant, the skullcap HUD blinks out. The clear plasma cells embedded in the wings fail in sequence—too clean, too fast.
Why: Changes the failure from random cascade to coordinated collapse.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: Of course, when she got the emergency notification, they rushed off to medi because Trisan was knocked out for three days. It stopped being funny at that point.
Revised: Of course, when she got the emergency notification, they rushed off to medi because Trisan was knocked out for three days. It stopped being funny at that point. But this doesn't feel like that.
Why: Lets her rationalize the failure, then undercuts the explanation.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: She simulated full-power-loss scenarios and the best ways to respond. She knows what to do.
Revised: She simulated full-power-loss scenarios and the best ways to respond. She knows what to do. Because she planned for failure. Just not like this.
Why: Sharpens the gap between training and the larger hidden rupture.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: She scans for the best locations for a survivable landing. There aren't any.
Revised: She scans for the best locations for a survivable landing. There aren't any. Not for someone like her.
Why: Connects the physical peril to Shail's identity pressure without explaining the hidden system.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: The wings level out, but she's low now. Land is coming up fast. She makes a last-second correction.
Revised: The wings level out, but she's low now. Land is coming up fast. No correction. No assist. No voice in her ear. She makes a last-second correction.
Why: This is the key AEA-absence beat. The scene now feels like the safety layer has vanished.

=== EDIT ===
SceneId: scn_eb08b7ef
Original: The sensation of slamming into a wall of snow lasts only a second before she is knocked unconscious.
Revised: She waits for the system to catch her. It doesn't. The sensation of slamming into a wall of snow lasts only a second before she is knocked unconscious.
Why: Makes the crash land emotionally and structurally: the system that should protect her is gone.`;

    const normalized = normalizeImportedReviewText(paste);
    expect(normalized).not.toBeNull();

    const parser = new SuggestionParser(new ReviewerDirectory());
    const parsed = parser.parse(normalized!);
    expect(parsed.suggestions).toHaveLength(10);
    expect(parsed.memos).toHaveLength(1);
  });
});
