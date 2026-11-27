---
name: inteiro-components
description: "Criar componentes e padrões de interação (botão, input, card, dashboard, dialog)."
license: MIT
metadata:
  inteiro: "1.0.0"
---

## Botão primary
Ação deliberada principal do contexto (salvar rascunho, revisar, editar).
Bom: [ Salvar rascunho ] primary   [ Publicar ] commit
Ruim: [ Cancelar ] [ Continuar ] [ Confirmar ] [ Salvar ] — quatro violet

## Botão commit
A ação sai do sistema para o mundo: publicar, deploy, aplicar.
Bom: [ Deploy ▸ ] commit
Ruim: Gráfico inteiro laranja “porque é marca”

## Botão danger
Ação destrutiva. Excluir, romper.
Bom: Excluir “projeto-x”? Remove também os três ambientes. [Cancelar] [Excluir projeto]
Ruim: Are you sure?

## Botão secondary
Ação relevante concorrente, não a deliberação principal.
Bom: [ Revisar mudanças ] secondary ao lado de [ Deploy ] commit
Ruim: Secondary filled violet

## Botão ghost
Ação contextual.
Bom: ghost em toolbar
Ruim: ghost com gradient

## Botão quiet
Baixa prioridade.
Bom: quiet “ver histórico”
Ruim: quiet com laranja

## Campo de formulário
Qualquer entrada de dado.
Bom: Informe um endereço completo, como nome@dominio.com
Ruim: borda vermelha e só

## Card neutro
Agrupar conteúdo sem interpretação especial.
Bom: surface + hairline + radius.lg
Ruim: glassmorphism + glow violet

## Card reflexivo
Reflexão editorial ou informação que muda interpretação.
Bom: data-kind=reflection
Ruim: Costura em cada card do dashboard

## Card de decisão
O bloco pede atravessar o limite.
Bom: data-kind=commit + botão commit
Ruim: Costura laranja decorativa

## Badge
Metadado descritivo, não acionável.
Bom: badge “PROD”
Ruim: badge clicável sem role de botão

## Dashboard
Visão operacional densa.
Bom: Sistema estável / As últimas 24h não mostram degradação relevante.
Ruim: Todos os KPI cards com Costura e laranja

## Editorial
Texto longo, reflexão, abertura.
Bom: max-inline-size: 70ch
Ruim: Inter no editorial e Recursive só no código

## Dialog / modal
Interromper para uma decisão.
Bom: modal elevation 3 + scrim 0.72
Ruim: modal sem scrim e sem trap de foco

## Tabela
Dados tabulares.
Bom: row 40px em focus, seleção com selection.background
Ruim: tabela com radius.full e hover glow

## Navegação
Orientar o produto.
Bom: nav sticky + item ativo violet
Ruim: nav glassmorphism neon

## Feedback de erro
Algo falhou.
Bom: Não foi possível salvar. A conexão foi interrompida antes da confirmação. Tentar novamente
Ruim: Oops! Algo deu errado 😅

## Feedback de sucesso
Resolução real.
Bom: Deploy concluído  production · 2f41c9a · agora
Ruim: Success! 🎉

## Estado vazio
Ainda não há dados.
Bom: Nenhum ambiente ainda. Criar o primeiro ambiente.
Ruim: Nada por aqui... ✨

## Loading e skeleton
Espera previsível.
Bom: skeleton surface + subtle identity
Ruim: spinner neon bounce infinito

## Foco visível
Sempre que houver controle.
Bom: outline: 2px solid var(--in-color-focus-ring); outline-offset: 2px;
Ruim: outline: none;
