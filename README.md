<p align="center">
  <img src="extension/icons/icon128.png" width="88" alt="Al Grano">
</p>

<h1 align="center">Al Grano</h1>

<p align="center"><strong>Tus notas de voz, al grano.</strong><br>
Extensión de Chrome que transcribe las notas de voz de WhatsApp Web dentro de la misma burbuja.<br>
En tu computadora, sin nube y gratis.</p>

<p align="center">
  <a href="https://github.com/sebaslobo22/al-grano/releases/latest/download/al-grano.zip"><strong>Descargar</strong></a> ·
  <a href="https://sebaslobo22.github.io/al-grano/">Página del proyecto</a>
</p>

---

## Qué hace

- **Transcribe sola** cada nota de voz del chat que abres, sin que le des play.
- **Se lee de un vistazo:** párrafos donde la persona hace pausa; horas, fechas, montos y correos resaltados; las notas largas se pliegan con «Ver todo».
- **Privada de verdad:** el audio se convierte en texto con el Whisper de tu propia computadora. Nada se sube a internet.
- **Recuerda:** lo ya transcrito se guarda y no se repite al volver al chat.

## Qué necesitas

1. **Chrome** (o un navegador basado en Chromium que permita cargar extensiones descomprimidas).
2. **[OpenWhispr](https://openwhispr.com)**, gratis y de código abierto, con un **modelo local** descargado en sus ajustes. Déjalo abierto: es el que convierte la voz en texto.

## Instalar (un minuto)

1. [Descarga `al-grano.zip`](https://github.com/sebaslobo22/al-grano/releases/latest/download/al-grano.zip) y descomprímelo.
2. En Chrome, escribe `chrome://extensions` en la barra de direcciones.
3. Activa **Modo de desarrollador** (arriba a la derecha) y toca **Cargar descomprimida**. Elige la carpeta que descomprimiste.
4. Recarga WhatsApp Web y abre un chat con notas de voz.

> No borres ni muevas la carpeta después de instalarla: Chrome lee la extensión desde ahí.

## Si algo no sale

| Ves esto | Qué hacer |
|---|---|
| «OpenWhispr está cerrado» | Abre OpenWhispr y toca **Reintentar**. |
| «Reprodúcela un segundo para transcribirla» | WhatsApp cambió algo por dentro. Dale play a la nota y se transcribe igual. |
| No aparece nada | Recarga WhatsApp Web. Revisa en el ícono de Al Grano que diga **Conectado**. |

## Cómo funciona

1. WhatsApp Web ya tiene la nota descifrada en tu navegador; Al Grano la toma de ahí.
2. La convierte al formato que lee Whisper y se la pasa al servidor local de OpenWhispr (`127.0.0.1`, se detecta solo).
3. Ordena el texto en párrafos usando las pausas que marca Whisper y resalta los datos clave con reglas simples, sin otra IA.

Todo el código está en [`extension/`](extension/): JavaScript plano, sin dependencias ni paso de compilación.

## Límites honestos

- Usa piezas internas de WhatsApp Web que pueden cambiar sin aviso. Si eso pasa, la transcripción automática puede fallar hasta actualizar la extensión (dar play sigue funcionando).
- Todavía no está en la Chrome Web Store: se instala a mano.
- La calidad depende del modelo que elijas en OpenWhispr.

---

**In English:** Al Grano is a Chrome extension that transcribes WhatsApp Web voice notes inside the chat bubble, locally, using the Whisper server that [OpenWhispr](https://openwhispr.com) runs on your computer. Nothing is uploaded. Install: download the zip, open `chrome://extensions`, enable Developer mode, «Load unpacked».

---

Un proyecto de [Sebastián Lobo](https://sitio-lobo.vercel.app). Licencia [MIT](LICENSE).
No afiliado a WhatsApp ni a Meta.
