---
name: inteiro-audit
description: "Auditar uma interface existente contra INTEIRO e WCAG 2.2."
license: MIT
metadata:
  inteiro: "1.0.0"
---

Execute `npx inteiro audit <path>` e revise:
- Texto normal ≥ 4.5:1. Texto grande ≥ 3:1. Componente ≥ 3:1.
- Focus visível e distinto de selected.
- Navegação completa por teclado.
- Não depender só de cor.
- prefers-reduced-motion.
- 320px reflow. 200%/400% zoom. Text-spacing override.
- Disabled ≠ readonly. Erro com mensagem textual.
- LTR + RTL. Name/role/state para leitor de tela.
- Propriedades lógicas: margin-inline, border-inline-start, text-align: start.
Checklist identitário: a tela parece SaaS genérico? Purple decorativo? Orange é decisão real? Costura comunica algo?

