// Zone de texte sur plusieurs lignes pour les fenêtres du plugin. Le widget « textbox » du jeu n'affiche qu'une
// ligne : on dessine donc le texte nous-mêmes (widget « custom », retour à la ligne par mot) et on le saisit dans
// la fenêtre de saisie du jeu (ui.showTextInput), ouverte par un bouton « Edit… ».

export const TEXT_AREA_LINES = 4;
const LINE_HEIGHT = 11;
const PAD = 3;

/** Hauteur du widget pour `lines` lignes de texte. */
export function textAreaHeight(lines = TEXT_AREA_LINES): number {
    return lines * LINE_HEIGHT + 2 * PAD;
}

// g.text interprète les codes de formatage ({RED}, {NEWLINE}…) : on neutralise les accolades du texte saisi.
function plain(text: string): string {
    return text.replace(/[{}]/g, (c) => (c === "{" ? "(" : ")")).replace(/\s+/g, " ").trim();
}

/** Coupe `text` en lignes d'au plus `width` pixels ; un mot trop long est coupé au caractère. */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of plain(text).split(" ")) {
        if (!word) continue;
        const candidate = line ? `${line} ${word}` : word;
        if (measure(candidate) <= width) {
            line = candidate;
            continue;
        }
        if (line) lines.push(line);
        line = "";
        let rest = word;
        while (measure(rest) > width && rest.length > 1) {
            let n = rest.length - 1;
            while (n > 1 && measure(rest.slice(0, n)) > width) n--;
            lines.push(rest.slice(0, n));
            rest = rest.slice(n);
        }
        line = rest;
    }
    if (line) lines.push(line);
    return lines;
}

/** Garde au plus `max` lignes ; si le texte déborde, la dernière se termine par « … ». */
export function clampLines(lines: string[], max: number, width: number, measure: (s: string) => number): string[] {
    if (lines.length <= max) return lines;
    const kept = lines.slice(0, max);
    let last = kept[max - 1];
    while (last && measure(`${last}…`) > width) last = last.slice(0, -1);
    kept[max - 1] = `${last.trimEnd()}…`;
    return kept;
}

export interface TextAreaOptions {
    name: string;
    x: number;
    y: number;
    width: number;
    lines?: number;
    /** Texte courant (lu à chaque dessin). */
    get: () => string;
    /** Couleur de la fenêtre (palette du jeu) pour le fond et le texte, comme un textbox. */
    colour: () => number;
}

/** Widget « custom » qui affiche le texte retourné à la ligne dans un cadre en creux. */
export function textAreaWidget(o: TextAreaOptions): CustomDesc {
    const height = textAreaHeight(o.lines);
    return {
        type: "custom",
        name: o.name,
        x: o.x,
        y: o.y,
        width: o.width,
        height,
        onDraw(g: GraphicsContext) {
            const colour = o.colour();
            g.colour = colour;
            // g.width / g.height = zone redessinée (rectangle sale), pas le widget : on prend les dimensions du widget.
            // Le jeu découpe le dessin à (largeur - 2) x (hauteur - 2).
            g.well(0, 0, o.width - 2, height - 2);
            const measure = (s: string) => g.measureText(s).width;
            const inner = o.width - 2 * PAD - 4;
            const lines = clampLines(wrapText(o.get(), inner, measure), o.lines ?? TEXT_AREA_LINES, inner, measure);
            lines.forEach((line, i) => g.text(line, PAD + 1, PAD + i * LINE_HEIGHT));
        },
    };
}

/** Redessine le widget « custom » (le réaffecter à sa position invalide son rectangle). */
export function redrawTextArea(win: Window, name: string): void {
    try {
        const w = win.findWidget<CustomWidget>(name);
        w.x = w.x;
    } catch {
        // fenêtre en cours de fermeture
    }
}

export interface EditTextOptions {
    title: string;
    description: string;
    initial: string;
    maxLength: number;
    onDone: (text: string) => void;
}

/** Ouvre la fenêtre de saisie du jeu ; `onDone` reçoit le texte validé (pas appelé si l'utilisateur annule). */
export function editText(o: EditTextOptions): void {
    ui.showTextInput({
        title: o.title,
        description: o.description,
        initialValue: o.initial,
        maxLength: o.maxLength,
        callback: (value: string) => o.onDone(value),
    });
}
