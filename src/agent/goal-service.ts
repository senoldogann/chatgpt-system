// Manuel goal sürücüsü: bütün iş bitmiş mi, kalan en büyük tutarlı iş nedir?
// Otomatik gönderim yoktur; sadece bir sonraki talimat önerisi döner.
// Loop (asla durmayan) modu taşınmamıştır; biten iş her zaman stop der.

export interface GoalPlanStep {
  step: string;
  status: string;
  details?: string;
}

export interface GoalAdviseInput {
  objective: string;
  transcriptTail: string;
  planSteps: GoalPlanStep[];
  successCriteria: string[];
  nextStep?: string;
}

export interface GoalAdvice {
  action: "stop" | "continue";
  reply: string;
  reason: string;
}

const DONE_MARKERS = [/^(?:done|completed|finished|passed|verified|closed)\b/i, /✓|✔|✅/];
const OPEN_MARKERS = [/^(?:todo|open|pending|in_progress|in-progress|blocked|failed|missing)\b/i, /❌|⛔/];

function stepIsDone(status: string): boolean {
  const normalized = status.trim();
  if (OPEN_MARKERS.some((pattern) => pattern.test(normalized))) return false;
  return DONE_MARKERS.some((pattern) => pattern.test(normalized));
}

function evidenceLine(haystack: string, needle: string): boolean {
  const words = needle.toLowerCase().split(/[^a-z0-9çğıöşü]+/i).filter((word) => word.length > 3);
  if (words.length === 0) return false;
  const lower = haystack.toLowerCase();
  const hits = words.filter((word) => lower.includes(word)).length;
  return hits / words.length >= 0.6;
}

function largestRemainingWork(input: GoalAdviseInput): string[] {
  const remaining: string[] = [];
  for (const step of input.planSteps) {
    if (!stepIsDone(step.status)) remaining.push(step.step);
  }
  return remaining;
}

// Bütün brief ve düzeltmeler görünür tutulur; sıradaki tur en büyük kalan
// tutarlı işe verilir. Küçük düzeltmeler ayrı tur olmaz, işin içine gömülür.
export function decideGoal(input: GoalAdviseInput): GoalAdvice {
  const objective = input.objective.trim();
  const transcript = input.transcriptTail.trim();
  const remaining = largestRemainingWork(input);

  const unmetCriteria = input.successCriteria.filter((criterion) => !evidenceLine(transcript, criterion));
  const hasOpenSteps = remaining.length > 0;

  if (!hasOpenSteps && unmetCriteria.length === 0) {
    if (objective !== "" && !evidenceLine(transcript, objective)) {
      return {
        action: "continue",
        reply: `Devam et: "${objective}" hedefinin tamamlandığını gösteren somut kanıt henüz yok. Kalan işi bitir ve sonucu doğrula.`,
        reason: "Plan adımları bitmiş görünüyor ama hedef cümlesi transkriptte kanıtlanmamış.",
      };
    }
    return { action: "stop", reply: "", reason: "Plan adımları ve başarı kriterleri tamamlanmış." };
  }

  const parts: string[] = [];
  if (objective !== "") parts.push(`Hedef: ${objective}.`);
  if (remaining.length > 0) {
    parts.push(`Kalan iş (en büyük tutarlı blok): ${remaining.join("; ")}.`);
  }
  if (unmetCriteria.length > 0) {
    parts.push(`Henüz kanıtlanmamış kriterler: ${unmetCriteria.join("; ")}.`);
  }
  if (input.nextStep !== undefined && input.nextStep.trim() !== "") {
    parts.push(`Sıradaki adım: ${input.nextStep.trim()}.`);
  }
  parts.push("Uygulama, entegrasyon ve ilgili doğrulamayı birlikte yap; sonucu somut kanıtla raporla.");
  return {
    action: "continue",
    reply: parts.join(" "),
    reason: `${remaining.length} açık plan adımı, ${unmetCriteria.length} kanıtlanmamış kriter.`,
  };
}
