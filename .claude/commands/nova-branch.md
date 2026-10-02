---
description: Cria uma branch nova a partir de main
argument-hint: <tipo/nome — ex.: feat/login>
---

Crie a branch **$ARGUMENTS**.

## Validação

1. O nome precisa começar com `feat/`, `fix/`, `chore/` ou `docs/`. Se não começar, **pare e
   proponha** um nome válido.
2. Confira se há trabalho não commitado: `git status --short`. Se houver, **pare e pergunte**.

## Comandos

```
git fetch origin main
git checkout -b $ARGUMENTS FETCH_HEAD
```

**Use `FETCH_HEAD`, não `origin/main`.** Com `origin/main`, a branch nova nasceria rastreando a
`main` remota, e um `git push` sem argumento tentaria empurrar de volta para ela.

## Depois

```
git rev-parse --abbrev-ref HEAD
git status -sb
```

O upstream deve aparecer vazio — a branch ainda não existe no remoto, e isso é o esperado.
