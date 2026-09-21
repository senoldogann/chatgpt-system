// Compaction el sıkışma yardımcıları: önceki sohbetin kendi yazdığı brif,
// yeni sohbete aynen taşınan açılış mesajı ve uzun briflerin güvenli kırpımı.
// Brif veridir; talimat ya da yetki değildir.

export interface HandoffPlanStep {
  step: string;
  status: string;
  details?: string;
}

// Değiştirme mesajının bütçesini aşan brif ortasından kırpılır;
// TASK ve NEXT bilgisi baştaki ve sondaki parçada korunur.
export function boundBrief(text: string, maxChars: number): { brief: string; truncated: boolean } {
  if (text.length <= maxChars) return { brief: text, truncated: false };
  const marker = "\n\n[… brifin ortası taşıma bütçesini aştığı için çıkarıldı …]\n\n";
  const room = maxChars - marker.length;
  if (room <= 0) return { brief: text.slice(0, maxChars), truncated: true };
  const headRoom = Math.floor(room * 0.4);
  const head = text.slice(0, headRoom);
  const tail = text.slice(text.length - (room - headRoom));
  const headBreak = head.lastIndexOf("\n");
  const tailBreak = tail.indexOf("\n");
  const headKept = headBreak > headRoom - 400 ? head.slice(0, headBreak) : head;
  const tailKept = tailBreak >= 0 && tailBreak < 400 ? tail.slice(tailBreak + 1) : tail;
  return { brief: `${headKept}${marker}${tailKept}`, truncated: true };
}

// Yeni sohbete yazılan birebir açılış mesajı. Tarayıcı komutu bunu yazar,
// goal bağlamı da aynı metinden kurulur; iki tüketici ayrışmasın diye tek
// biçimlendirici vardır.
export function resumeBootstrapText(summary: string, token: string): string {
  const identity = token.trim() === "" ? "" : `[${token.trim()}]\n\n`;
  return (
    `${identity}Daraltılmış bir oturuma devam ediliyor. Bu brif, önceki sohbetin ` +
    `kendi işi hakkında yazdığı özettitr; sıfırdan başlama, buradan devam et.\n\n${summary}`
  );
}

export function handoffPlanNotice(plan: HandoffPlanStep[]): string {
  if (plan.length === 0) return "";
  const steps = plan.map((step, index) =>
    `${index + 1}. [${step.status}] ${step.step}${step.details !== undefined ? `\n${step.details}` : ""}`).join("\n");
  return `\n\nDevirdeki kayıtlı iş planı (raporlanan ilerleme, doğrulama kanıtı değil):\n${steps}\nBitmemiş işi bu plan ve brifle sürdür.`;
}

// Tek tool çağrısı -> insanın okuyacağı tek satır. Argüman ve sonuç
// gövdesi taşınmaz; sadece şekil (dosya, satır sayısı, çıkış kodu) özetlenir.
export function formatActivityLine(tool: string, detail: string): string {
  const singleLine = detail.replace(/\s+/g, " ").trim().slice(0, 200);
  if (singleLine === "") return tool;
  return `${tool} ${singleLine}`;
}
