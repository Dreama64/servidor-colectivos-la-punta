const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

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
app.post('/report', upload.single('photo'), (req, res) => {
  try {
    const { author, dateTime, description } = req.body;
    const photoFile = req.file;

    console.log(`🚨 NUEVO REPORTE EN TRÁMITE:`);
    console.log(`- Emisor: ${author}`);
    console.log(`- Fecha: ${dateTime}`);
    console.log(`- Detalle: ${description}`);
    if (photoFile) console.log(`- Evidencia recibida: ${photoFile.filename}`);

    return res.status(200).json({ success: true, message: 'Reporte procesado exitosamente' });

  } catch (error) {
    console.error('Error en /report:', error);
    return res.status(500).json({ success: false, error: 'Error al procesar reporte' });
  }
});

app.get('/', (req, res) => {
  res.send('Servidor Walkie-Talkie Secoll Communications en línea 🟢');
});

// -------------------------------------------------------------
// GESTIÓN DE WEBSOCKETS Y PRESENCIA REAL DE USUARIOS
// -------------------------------------------------------------

// Mapa para rastrear los datos de cada cliente conectado
const clientsMap = new Map();

function transmitirListaUsuarios(canalActual) {
  const usuariosEnCanal = [];
  
  clientsMap.forEach((data, clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN && data.canal === canalActual && data.nombre) {
      usuariosEnCanal.push({
        id: data.id,
        nombre: data.nombre,
        canal: data.canal
      });
    }
  });

  const payload = JSON.stringify({
    type: 'lista_usuarios',
    tipo: 'lista_usuarios',
    canal: canalActual,
    usuarios: usuariosEnCanal
  });

  clientsMap.forEach((data, clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN && data.canal === canalActual) {
      clientWs.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('Cliente conectado por WebSocket 🟢');
  
  clientsMap.set(ws, { id: Date.now().toString(), nombre: 'Guardia', canal: 'General' });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // 1. REGISTRO O CAMBIO DE CANAL
      if (data.type === 'join_channel' || data.emisor || data.canal || data.sala) {
        const clientInfo = clientsMap.get(ws) || {};
        const canalAnterior = clientInfo.canal;
        
        clientInfo.nombre = data.emisor || clientInfo.nombre;
        clientInfo.canal = data.sala || data.canal || data.room || 'General';
        
        clientsMap.set(ws, clientInfo);

        transmitirListaUsuarios(clientInfo.canal);
        if (canalAnterior && canalAnterior !== clientInfo.canal) {
          transmitirListaUsuarios(canalAnterior);
        }
      }

      // 2. REENVIAR MENSAJES Y CHATS
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });

    } catch (e) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message.toString());
        }
      });
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado de WebSocket 🔴');
    const clientInfo = clientsMap.get(ws);
    clientsMap.delete(ws);

    if (clientInfo && clientInfo.canal) {
      transmitirListaUsuarios(clientInfo.canal);
    }
  });
});

// Iniciar el servidor
server.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
  console.log(`URL Base configurada: ${BASE_URL}`);
});