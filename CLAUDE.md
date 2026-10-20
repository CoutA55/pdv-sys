# PDV para mercadinho

Sistema de ponto de venda (caixa, estoque, fiado) para um mercadinho. Roda local em mini PC com Linux (Ryzen 5, 8 GB). Será vendido como produto.

## Stack
- Node.js + Express, SQLite (better-sqlite3), JavaScript puro
- Front-end: React + Vite (pasta web/, ainda não criada)

## Regras
- Dinheiro sempre em centavos (inteiro). IDs em UUID.
- Toda venda dentro de uma transação (venda, itens, estoque, pagamento).
- Estoque e fiado são livro-razão: movimentações, nunca saldo editado à mão. Estorno gera lançamento inverso.
- Venda sem depender de rede. Tela de venda com foco no teclado e no leitor de código de barras.
- Migrações SQL numeradas em server/migrations. Nunca commitar arquivos .db.
- Textos da interface em português simples.