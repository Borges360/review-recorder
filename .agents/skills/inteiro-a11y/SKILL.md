---
name: inteiro-a11y
description: "Revisar acessibilidade INTEIRO / WCAG 2.2 AA, foco, target 44px, RTL, reduced motion."
license: MIT
metadata:
  inteiro: "1.0.0"
---

Baseline WCAG 2.2 AA. Target primário INTEIRO 44×44. Focus ring 2px offset 2px. Estados são linguagem global.

- Texto normal ≥ 4.5:1. Texto grande ≥ 3:1. Componente ≥ 3:1.
- Focus visível e distinto de selected.
- Navegação completa por teclado.
- Não depender só de cor.
- prefers-reduced-motion.
- 320px reflow. 200%/400% zoom. Text-spacing override.
- Disabled ≠ readonly. Erro com mensagem textual.
- LTR + RTL. Name/role/state para leitor de tela.
- Propriedades lógicas: margin-inline, border-inline-start, text-align: start.

Evitar:
- Remover outline.
- Erro só com borda vermelha.
- z-index: 999999.
