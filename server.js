const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
// Presencia de usuarios y chat en tiempo real

const clientesConectados = new Map();

function enviarListaUsuarios(sala) {
  const usuarios = [];

  clientesConectados.forEach((datos, socket) => {
    if (
      socket.readyState === WebSocket.OPEN &&
      datos.sala === sala &&
      datos.nombre
    ) {
      usuarios.push({ nombre: datos.nombre });
    }
  });

  const mensaje = JSON.stringify({
    type: 'lista_usuarios',
    sala,
    usuarios
  });

  clientesConectados.forEach((datos, socket) => {
    if (
      socket.readyState === WebSocket.OPEN &&
      datos.sala === sala
    ) {
      socket.send(mensaje);
    }
  });
}

wss.on('connection', (socket) => {
  clientesConectados.set(socket, {
    nombre: null,
    sala: 'General'
  });

  console.log('Cliente conectado por WebSocket');

  socket.on('message', (buffer) => {
    try {
      const data = JSON.parse(buffer.toString());

      // El usuario entra o cambia de canal
      if (data.type === 'join_channel') {
        const anterior = clientesConectados.get(socket);
        const salaAnterior = anterior?.sala;

        const nombre = String(data.emisor || '').trim();

        const sala = String(
          data.sala ||
          data.canal ||
          data.room ||
          'General'
        ).trim();

        if (!nombre) return;

        clientesConectados.set(socket, {
          nombre,
          sala
        });

        if (salaAnterior && salaAnterior !== sala) {
          enviarListaUsuarios(salaAnterior);
        }

        enviarListaUsuarios(sala);

        console.log('Usuario conectado:', nombre, 'Canal:', sala);
        return;
      }

      // El usuario sale del canal pero mantiene abierto el WebSocket
      if (data.type === 'leave_channel') {
        const datos = clientesConectados.get(socket);
        const salaAnterior = datos?.sala;

        clientesConectados.set(socket, {
          nombre: datos?.nombre || String(data.emisor || '').trim(),
          sala: null
        });

        if (salaAnterior) {
          enviarListaUsuarios(salaAnterior);
        }

        console.log('Usuario salio del canal:', datos?.nombre || data.emisor);
        return;
      }

      // Mensajes de chat
      if (
        data.type === 'nuevo_mensaje_texto' ||
        data.tipo === 'nuevo_mensaje_texto'
      ) {
        const datos = clientesConectados.get(socket);

        const sala = String(
          data.sala ||
          data.canal ||
          data.room ||
          datos?.sala ||
          'General'
        ).trim();

        const contenido = String(
          data.texto ||
          data.mensaje ||
          ''
        ).trim();

        if (!contenido) return;

        const mensaje = JSON.stringify({
          type: 'nuevo_mensaje_texto',
          tipo: 'nuevo_mensaje_texto',
          sala,
          canal: sala,
          room: sala,
          emisor: data.emisor || datos?.nombre || 'Compañero',
          texto: contenido,
          mensaje: contenido,
          timestamp: data.timestamp || new Date().toISOString(),
          id: data.id || Date.now().toString()
        });

        clientesConectados.forEach((info, cliente) => {
          if (
            cliente !== socket &&
            cliente.readyState === WebSocket.OPEN &&
            info.sala === sala
          ) {
            cliente.send(mensaje);
          }
        });

        console.log('Mensaje enviado en:', sala);
      }

    } catch (error) {
      console.error(
        'Mensaje WebSocket invalido:',
        error.message
      );
    }
  });

  socket.on('close', () => {
    const datos = clientesConectados.get(socket);

    clientesConectados.delete(socket);

    if (datos?.sala) {
      enviarListaUsuarios(datos.sala);
    }

    console.log(
      'Cliente desconectado:',
      datos?.nombre || 'sin identificar'
    );
  });

  socket.on('error', (error) => {
    console.error('Error WebSocket:', error.message);
  });
});
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Asegurar que la carpeta de subidas exista
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configuración de almacenamiento con Multer (para audio e imágenes)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || (file.mimetype && file.mimetype.includes('image') ? '.jpg' : '.m4a');
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});

const upload = multer({ storage: storage });

// Middlewares
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Servir archivos estáticos
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m4a')) {
      res.setHeader('Content-Type', 'audio/mp4'); 
      res.setHeader('Accept-Ranges', 'bytes');    
      res.setHeader('Cache-Control', 'no-store');  
    }
  }
}));

// -------------------------------------------------------------
// ENDPOINT 1: Subida y Retransmisión de Audio
// -------------------------------------------------------------
app.post('/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se recibió ningún archivo de audio' });
    }

    const emisor = req.body.emisor || 'desconocido';
    const sala = req.body.sala || req.body.canal || req.body.room || 'General';
    const fileUrl = `${BASE_URL}/uploads/${req.file.filename}`;

    const mensajeNotificacion = JSON.stringify({
      type: 'nuevo_audio',
      url: fileUrl,
      emisor: emisor,
      sala: sala
    });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(mensajeNotificacion);
      }
    });

    return res.status(200).json({ success: true, url: fileUrl });

  } catch (error) {
    console.error('Error en el endpoint /upload:', error);
    return res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// -------------------------------------------------------------
// ENDPOINT 2: Recepción de Reportes (Registra foto y datos)
// -------------------------------------------------------------
app.post('/report', upload.single('photo'), async (req, res) => {
  try {
    const { author, dateTime, description } = req.body;
    const photoFile = req.file;

    console.log("🚨 NUEVO REPORTE EN TRÁMITE:");
    console.log("- Emisor:", author);
    console.log("- Fecha:", dateTime);
    console.log("- Detalle:", description);
    if (photoFile) console.log("- Evidencia recibida:", photoFile.filename);

    const mailOptions = {
      from: "\x22Colectivos La Punta - Alertas\x22 <" + (process.env.EMAIL_USER || 'sebads128@gmail.com') + ">",
      to: 'sebads128@gmail.com',
      subject: `🚨 Reporte de Terreno - ${author || "Chofer"} (${dateTime || "Ahora"})`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #0c0d0e; color: #ffffff; padding: 20px; border-radius: 8px;">
          <h2 style="color: #FACC15; border-bottom: 2px solid #FACC15; padding-bottom: 8px;">
            🚕 Nuevo Reporte de Incidencia en Terreno
          </h2>
          <p><strong>Emisor / Móvil:</strong> ${author || "No especificado"}</p>
          <p><strong>Fecha y Hora:</strong> ${dateTime || "No especificada"}</p>
          <p><strong>Detalle de la novedad:</strong></p>
          <blockquote style="background-color: #16181a; border-left: 4px solid #FACC15; padding: 10px 14px; margin: 10px 0;">
            ${description || "Sin detalle"}
          </blockquote>
          ${photoFile ? "<p><em>📸 Se adjuntó una fotografía de evidencia.</em></p>" : "<p><em>Sin archivo fotográfico adjunto.</em></p>"}
        </div>
      `,
      attachments: photoFile ? [
        {
          filename: photoFile.originalname || photoFile.filename,
          path: photoFile.path,
        }
      ] : [],
    };

    if (process.env.RESEND_API_KEY) {
      const attachments = photoFile ? [{
        filename: photoFile.originalname || photoFile.filename,
        content: fs.readFileSync(photoFile.path),
      }] : [];

      await resend.emails.send({
        from: "Colectivos La Punta <onboarding@resend.dev>",
        to: "sebads128@gmail.com",
        subject: `🚨 Reporte de Terreno - ${author || "Chofer"} (${dateTime || "Ahora"})`,
        html: mailOptions.html,
        attachments: attachments,
      });
      console.log("✅ Correo despachado vía HTTPS a sebads128@gmail.com");
    } else {
      console.log("⚠️ Correo omitido: RESEND_API_KEY no configurada.");
    }

    return res.status(200).json({ success: true, message: 'Reporte procesado exitosamente' });
  } catch (error) {
    console.error("Error en /report:", error);
    return res.status(500).json({ success: false, error: 'Error al procesar reporte' });
  }
});

// Iniciar el servidor
server.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
  console.log(`URL Base configurada: ${BASE_URL}`);
});