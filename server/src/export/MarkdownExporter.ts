import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewPackage, TimelineEntry } from '../shared/types.js';

const PREAMBLE = `Este arquivo descreve uma sessão real de revisão da aplicação.

Observações representam intenção do usuário.
Screenshots são evidências visuais.
ScreenState representa o estado semântico da aplicação quando a observação ocorreu.
Não assuma alterações não mencionadas.
Quando houver ambiguidade entre fala e elemento, consulte a evidência correspondente.
O diretório raw/ contém informação detalhada caso o contexto compactado seja insuficiente.

---

`;

export class MarkdownExporter {
  constructor(private readonly sessionDir: string) {}

  export(review: ReviewPackage): void {
    const lines: string[] = [
      PREAMBLE,
      '# UI Review',
      '',
      `Session: ${review.session.name}`,
      '',
      `Started: ${review.session.startedAt}`,
      `Active duration: ${review.session.activeDurationSeconds}s`,
      `Wall duration: ${review.session.wallDurationSeconds}s`,
      '',
    ];

    for (const entry of review.timeline) {
      lines.push(...this.formatEntry(entry));
      lines.push('');
    }

    writeFileSync(join(this.sessionDir, 'REVIEW.md'), lines.join('\n'), 'utf8');
  }

  private formatEntry(entry: TimelineEntry): string[] {
    const lines: string[] = [`## ${entry.offset}`];

    switch (entry.type) {
      case 'session':
        lines.push('', `**${entry.label}**`, `Jornada: ${entry.name}`);
        break;
      case 'pause':
        lines.push('', '**PAUSE**');
        break;
      case 'resume':
        lines.push('', '**RESUME**');
        break;
      case 'screen': {
        const screen = entry.screen as { title?: string; url?: string };
        lines.push('', `**SCREEN** — ${screen.title ?? 'Unknown'}`, '', 'URL:', `\`${screen.url ?? ''}\``);
        break;
      }
      case 'action':
        lines.push('', `**ACTION** — ${entry.action}`);
        break;
      case 'observation': {
        const speech = entry.speech as { text?: string };
        const screen = entry.screen as { title?: string; url?: string };
        lines.push(
          '',
          `**OBSERVATION** — ${screen.title ?? ''}`,
          '',
          'URL:',
          `\`${screen.url ?? ''}\``,
          '',
          'Observação:',
          `"${speech.text ?? ''}"`,
        );
        if (entry.scope === 'ELEMENT' && entry.candidateElement) {
          const el = entry.candidateElement as { accessibleName?: string; role?: string };
          lines.push('', `Elemento candidato (${entry.associationConfidence}):`, `\`${el.role} "${el.accessibleName}"\``);
        }
        break;
      }
      case 'evidence': {
        const evidence = entry.evidence as { path?: string }[];
        lines.push('', '**EVIDENCE**');
        for (const ev of evidence ?? []) {
          lines.push('', `\`${ev.path}\``);
        }
        break;
      }
    }

    return lines;
  }
}
