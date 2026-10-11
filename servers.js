const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ==================== ИГРОВОЕ СОСТОЯНИЕ ====================
const players = {};       // id -> { x, y, z, yaw, hp, kills, name }
const bullets = [];       // активные пули для визуала
let bulletId = 0;

function randomSpawn() {
  return {
    x: (Math.random() - 0.5) * 60,
    y: 1.7,
    z: (Math.random() - 0.5) * 60
  };
}

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  console.log('✅ Подключился:', socket.id);

  const spawn = randomSpawn();
  players[socket.id] = {
    id: socket.id,
    name: 'Player_' + socket.id.slice(0, 4),
    x: spawn.x, y: spawn.y, z: spawn.z,
    yaw: 0, pitch: 0,
    hp: 100,
    kills: 0,
    lastShot: 0
  };

  // Отправляем новому игроку список всех
  socket.emit('init', { id: socket.id, players });

  // Остальным — что новый зашёл
  socket.broadcast.emit('playerJoined', players[socket.id]);

  // ==================== ДВИЖЕНИЕ ====================
  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = data.x;
    p.y = data.y;
    p.z = data.z;
    p.yaw = data.yaw;
    p.pitch = data.pitch;
    // Рассылаем всем кроме отправителя
    socket.broadcast.emit('playerMoved', {
      id: socket.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch
    });
  });

  // ==================== СТРЕЛЬБА ====================
  socket.on('shoot', (data) => {
    const shooter = players[socket.id];
    if (!shooter) return;

    // Проверка цели на сервере (античит базовый)
    const target = players[data.targetId];
    if (!target) return;

    // Проверка дистанции
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const dz = target.z - shooter.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dist > 100) return; // слишком далеко

    // Урон
    const dmg = data.headshot ? 100 : 34;
    target.hp -= dmg;

    // Оповещаем всех о выстреле (визуал)
    io.emit('bulletFired', {
      id: bulletId++,
      from: socket.id,
      fromPos: { x: shooter.x, y: shooter.y, z: shooter.z },
      toPos: data.hitPoint || null,
      hitPlayer: data.targetId
    });

    if (target.hp <= 0) {
      // Убийство
      shooter.kills++;
      target.hp = 100;
      const spawn = randomSpawn();
      target.x = spawn.x; target.y = spawn.y; target.z = spawn.z;

      io.emit('playerKilled', {
        killer: socket.id,
        victim: target.id,
        killerName: shooter.name,
        victimName: target.name,
        respawn: { x: target.x, y: target.y, z: target.z }
      });

      io.emit('scoreUpdate', {
        id: shooter.id, kills: shooter.kills
      });

      // Обновляем HP жертвы
      io.to(target.id).emit('youRespawned', { hp: 100, ...spawn });
    } else {
      // Обновляем HP цели
      io.to(target.id).emit('hpUpdate', { hp: target.hp });
    }
  });

  // ==================== СМЕНА ИМЕНИ ====================
  socket.on('setName', (name) => {
    if (players[socket.id]) {
      players[socket.id].name = String(name).slice(0, 16);
      io.emit('playerRenamed', { id: socket.id, name: players[socket.id].name });
    }
  });

  // ==================== ОТКЛЮЧЕНИЕ ====================
  socket.on('disconnect', () => {
    console.log('❌ Отключился:', socket.id);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
  console.log(`📱 Для телефона: http://<твой-IP>:${PORT}`);
});
