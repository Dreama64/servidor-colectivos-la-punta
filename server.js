const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'sebads128@gmail.com',
    pass: process.env.EMAIL_PASS,
  },
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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

    if (process.env.EMAIL_PASS) {
      await transporter.sendMail(mailOptions);
      console.log("✅ Correo despachado a sebads128@gmail.com");
    } else {
      console.log("⚠️ Correo omitido: EMAIL_PASS no está configurada.");
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