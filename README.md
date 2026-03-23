# G1on Editor

Editor de patches para Zoom G1on/G1Xon via Web MIDI API.

**Funciona diretamente no browser — sem instalação, sem servidor.**  
Hospedado em: https://seu-usuario.github.io/g1on-editor

---

## Requisitos

- Chrome ou Edge (Web MIDI + SysEx)
- Zoom G1on/G1Xon conectada via USB
- Permitir acesso MIDI quando o browser solicitar

## Como usar

1. Abra o editor no browser
2. Conecte a G1on via USB
3. Clique **CONNECT** → o pedal é identificado automaticamente
4. Clique **READ ALL** para carregar todos os patches
5. Clique em qualquer patch para editar

## Botões

| Botão | Função |
|---|---|
| **CONNECT** | Conecta/desconecta via Web MIDI |
| **READ ALL** | Lê todos os patches do pedal |
| **BACKUP** | Salva todos os patches em arquivo JSON |
| **RESTORE** | Restaura patches de um arquivo JSON |
| **EXPORT** | Exporta o patch atual como JSON |
| **IMPORT** | Importa um patch de arquivo JSON |
| **SHARE** | Gera link compartilhável do patch atual |
| **BACKUPS** | Gerencia backups automáticos locais |
| **WRITE** | Envia o patch editado para o pedal |
| **SELECT** | Seleciona o patch no pedal (Program Change) |
| **VOL** | Ajusta o volume do patch |
| **CLR** | Limpa todos os efeitos do patch |

## Sistema de salvamento

O editor tem 4 camadas de persistência, sem nenhum servidor:

| Camada | Tecnologia | Capacidade | Uso |
|---|---|---|---|
| L1 | IndexedDB | ~50MB+ | Primária — todos os patches + backups |
| L2 | localStorage | ~5MB | Fallback rápido e espelho |
| L3 | Arquivo JSON | Ilimitado | Export/import manual |
| L4 | URL hash | ~2KB | Compartilhar patch único via link |

**Auto-save:** patches são salvos automaticamente 2 segundos após qualquer alteração.  
**Auto-backup:** backup automático a cada 15 minutos se houver alterações (guarda os 10 mais recentes).  
**Pre-restore:** antes de qualquer RESTORE, o estado atual é salvo automaticamente.

## Deploy no GitHub Pages

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/SEU_USUARIO/g1on-editor.git
git push -u origin main
```

Em **Settings → Pages → Source**, selecione `main` / `/ (root)`.

URL ficará: `https://SEU_USUARIO.github.io/g1on-editor`

## Estrutura de arquivos

```
g1on-editor/
├── index.html          — HTML principal
├── css/
│   └── style.css       — Todos os estilos (original intacto)
├── js/
│   ├── engine.js       — Motor: tabelas de efeitos, codec Zoom, decode/encode
│   ├── storage.js      — Sistema de save/backup/redundância
│   └── app.js          — Lógica de app: MIDI, UI, connect, read, write
└── README.md
```

## Compatibilidade de dispositivos

| Dispositivo | ID | Patches |
|---|---|---|
| Zoom G1on | 0x61 | 100 |
| Zoom G1Xon | 0x62 | 100 |
| Zoom G1Xon-K | 0x63 | 100 |
| Zoom G1 FOUR | 0x64 | 50 |
| Zoom G1X FOUR | 0x65 | 50 |
| Zoom G3n | 0x6E | 60 |
| Zoom G5n | 0x73 | 60 |
| Zoom B1on | 0x5F | 100 |
| Zoom B1Xon | 0x66 | 100 |
| Zoom B1 FOUR | 0x71 | 50 |
| Zoom MS-50G | 0x58 | 50 |
