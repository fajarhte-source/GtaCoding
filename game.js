function bootGame(){
  "use strict";
  if (window.__JJC_BOOTED) return;
  window.__JJC_BOOTED = true;
  if (typeof THREE === "undefined"){ document.body.innerHTML = "<div style=\"padding:24px;color:#fff;background:#111\">Mesin 3D gagal dimuat.</div>"; return; }
  window.addEventListener('error', function(ev){
    console.error('JJC runtime error:', ev.error || ev.message);
    var box=document.getElementById('jjcDebugError');
    if(!box){ box=document.createElement('div'); box.id='jjcDebugError'; box.style.cssText='position:fixed;left:10px;right:10px;bottom:10px;z-index:99999;background:rgba(120,0,0,.92);color:#fff;padding:10px;border-radius:10px;font:12px monospace;'; document.body.appendChild(box); }
    box.textContent='Game error: '+(ev.message||'unknown');
  });

  // ================= basic setup =================
  var wrap = document.getElementById('canvasWrap');
  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb9c9d8, 95, 420);
  var gameClock = 0;      // waktu game (berhenti saat kuis / garasi terbuka)
  var savedQuiz = null;   // kemajuan kuis dari simpanan lokal
  var BK = { done:{}, robot:0x22d3ee, car:null, stages:{}, build:{}, sol:{} };   // kemajuan Bengkel Kode & warna pilihan
  var bkOpen = false;

  var camera = new THREE.PerspectiveCamera(62, window.innerWidth/window.innerHeight, 0.5, 500);
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  } catch(e) {
    document.body.innerHTML = '<div style="padding:24px;font-family:sans-serif;color:white;background:#111;min-height:100vh">WebGL tidak tersedia di browser ini.<br><small>'+e.message+'</small></div>';
    throw e;
  }
  var IS_TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, IS_TOUCH ? 1.75 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
  wrap.appendChild(renderer.domElement);

  window.addEventListener('resize', function(){
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    camOffset.set(0, camera.aspect < 1 ? 5.0 : 4.2, camera.aspect < 1 ? 9.0 : 7.8);   // kamera third-person sinematik
  });

  scene.background = new THREE.Color(0xaec6d8);
  // Sejak Three.js r155 lampu memakai satuan fisik, jadi intensitas dikali LIGHT_K agar tampilan mirip versi lama.
  var LIGHT_K = 3.0;
  var LAMP_K = 40;
  var hemi = new THREE.HemisphereLight(0xd9ecff, 0x29352a, 0.72 * LIGHT_K);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff3dc, 1.15 * LIGHT_K);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 42;   sun.shadow.camera.bottom = -42;
  sun.shadow.camera.near = 10;  sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);
  var focus = new THREE.Vector3(0, 0, 14);   // titik yang diikuti bayangan & culling (pemain / kendaraan)
  var moonAmbient = new THREE.AmbientLight(0x1a2340, 0.0);
  scene.add(moonAmbient);

  // ================= ground / roads =================
  var CITY_SIZE = 320;
  var CITY_HALF = CITY_SIZE/2 - 2;
  var groundMat = new THREE.MeshStandardMaterial({ color: 0x587a45, roughness: 1.0, metalness: 0.0 });
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_SIZE, CITY_SIZE), groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  var roadMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.92, metalness: 0.02 });
  var lineMat = new THREE.MeshStandardMaterial({ color: 0xd9c36a, roughness: 0.7, metalness: 0.0 });

  function addRoad(x, z, w, h){
    var road = new THREE.Mesh(new THREE.PlaneGeometry(w, h), roadMat);
    road.rotation.x = -Math.PI/2;
    road.position.set(x, 0.01, z);
    road.receiveShadow = true;
    scene.add(road);
  }
  // Marka jalan: dulu ~740 mesh terpisah (740 draw call!). Sekarang 1 InstancedMesh.
  var lineDashes = [];
  function nearRoad(v){
    for (var i=0;i<roadPositions.length;i++){ if (Math.abs(v - roadPositions[i]) < 5.5) return true; }
    return false;
  }
  function addLineStripH(x0, x1, z){
    var count = Math.floor(Math.abs(x1-x0)/6);
    for (var i=0;i<count;i++){
      var cx = x0 + i*6 + (x1>x0?0:-6);
      if (nearRoad(cx)) continue;            // jangan gambar marka di tengah persimpangan
      lineDashes.push({ x:cx, z:z, h:true });
    }
  }
  function addLineStripV(z0, z1, x){
    var count = Math.floor(Math.abs(z1-z0)/6);
    for (var i=0;i<count;i++){
      var cz = z0 + i*6 + (z1>z0?0:-6);
      if (nearRoad(cz)) continue;
      lineDashes.push({ x:x, z:cz, h:false });
    }
  }
  function flushLineMarks(){
    var inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), lineMat, lineDashes.length);
    var m = new THREE.Matrix4();
    var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2, 0, 0));
    var p = new THREE.Vector3(), s = new THREE.Vector3();
    lineDashes.forEach(function(d, i){
      p.set(d.x, 0.03, d.z);
      s.set(d.h ? 2.4 : 0.35, d.h ? 0.35 : 2.4, 1);
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    scene.add(inst);
  }

  var roadPositions = [-120, -80, -40, 0, 40, 80, 120];
  roadPositions.forEach(function(p){
    addRoad(p, 0, 9, CITY_SIZE);
    addLineStripV(-CITY_SIZE/2, CITY_SIZE/2, p);
    addRoad(0, p, CITY_SIZE, 9);
    addLineStripH(-CITY_SIZE/2, CITY_SIZE/2, p);
  });

  // ================= buildings (+ collision boxes) =================
  var buildingColors = [0xd8caa8, 0xc9a084, 0xa7b7c9, 0xb9c9a3, 0xcbb3c9, 0xd9b98a];
  var buildingBoxes = [];
  function addBuilding(x, z, w, d, h, color){
    var geo = new THREE.BoxGeometry(w, h, d);
    var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.72, metalness: 0.04 });
    var b = new THREE.Mesh(geo, mat);
    b.position.set(x, h/2, z);
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(w*0.9, 0.6, d*0.9), new THREE.MeshStandardMaterial({color:0x30343a, roughness:0.9, metalness:0.08}));
    roof.position.set(x, h+0.3, z);
    roof.castShadow = true;
    scene.add(roof);

    // Facade details: repeated windows + balconies create depth instead of flat boxes.
    var facadeMat = new THREE.MeshStandardMaterial({color:0x93a9b8, roughness:.25, metalness:.05});
    var glassMat = new THREE.MeshStandardMaterial({color:0x31566b, roughness:.12, metalness:.35});
    var rows = Math.max(1, Math.floor(h/3.2));
    var cols = Math.max(1, Math.floor(w/1.7));
    for (var rr=0; rr<rows; rr++){
      for (var cc=0; cc<cols; cc++){
        if (Math.random() < 0.16) continue;
        var wx = x - w/2 + 0.85 + cc*Math.max(1.25,(w-1.2)/Math.max(1,cols-1));
        var wy = 1.45 + rr*2.6;
        if (wy > h-1.0) continue;
        var win = new THREE.Mesh(new THREE.BoxGeometry(.48,.72,.055), glassMat);
        win.position.set(wx,wy,z-d/2-0.035);
        win.castShadow = false;
        scene.add(win);
        if (Math.random()<0.18){
          var sill = new THREE.Mesh(new THREE.BoxGeometry(.62,.07,.13), facadeMat);
          sill.position.set(wx,wy-.43,z-d/2-.03); scene.add(sill);
        }
      }
    }

    // lit window at night
    if (Math.random() < 0.6){
      var win = new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.6), new THREE.MeshBasicMaterial({color:0xffe9a8, transparent:true, opacity:0}));
      win.position.set(x + w/2 + 0.02, h*0.55, z);
      win.rotation.y = Math.PI/2;
      scene.add(win);
      nightWindows.push(win);
    }
    buildingBoxes.push({ minX:x-w/2-0.6, maxX:x+w/2+0.6, minZ:z-d/2-0.6, maxZ:z+d/2+0.6 });
  }
  var nightWindows = [];
  // PERBAIKAN: dulu gedung diletakkan di kelipatan 40 (tepat di atas persimpangan/jalan) sehingga menutup jalan.
  // Sekarang gedung ditaruh di dalam blok, di antara jalan (jalan ada di kelipatan 40).
  var STATION = { x: 14, z: -14, r: 7 };   // SPBU & bengkel (modelnya dibangun di bagian sistem)
  var blockCenters = [-100, -60, -20, 20, 60, 100];
  var keepClear = [[10,6],[-20,-8],[-10,6],[22,20],[10,-8],[-22,-20],[0,30],[30,0],[0,14],[STATION.x, STATION.z]];
  blockCenters.forEach(function(cx){
    blockCenters.forEach(function(cz){
      var n = 2 + Math.floor(Math.random()*2);
      for (var k=0;k<n;k++){
        var w = 4+Math.random()*5, d = 4+Math.random()*5, h = 4+Math.random()*14;
        var x = cx + (Math.random()-0.5)*2*(14 - w/2);
        var z = cz + (Math.random()-0.5)*2*(14 - d/2);
        var blocked = keepClear.some(function(p){ return Math.abs(p[0]-x) < w/2+9 && Math.abs(p[1]-z) < d/2+9; });
        if (blocked) continue;
        addBuilding(x, z, w, d, h, buildingColors[Math.floor(Math.random()*buildingColors.length)]);
      }
    });
  });

  function isInsideAnyBuilding(x, z, margin){
    for (var i=0;i<buildingBoxes.length;i++){
      var bb = buildingBoxes[i];
      if (x > bb.minX-margin && x < bb.maxX+margin && z > bb.minZ-margin && z < bb.maxZ+margin) return true;
    }
    return false;
  }
  function resolveBuildingCollision(pos, radius){
    for (var i=0;i<buildingBoxes.length;i++){
      var bb = buildingBoxes[i];
      var minX = bb.minX-radius, maxX = bb.maxX+radius, minZ = bb.minZ-radius, maxZ = bb.maxZ+radius;
      if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ){
        var overlapLeft = pos.x - minX, overlapRight = maxX - pos.x;
        var overlapTop = pos.z - minZ, overlapBottom = maxZ - pos.z;
        var minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
        if (minOverlap === overlapLeft) pos.x = minX;
        else if (minOverlap === overlapRight) pos.x = maxX;
        else if (minOverlap === overlapTop) pos.z = minZ;
        else pos.z = maxZ;
        return true;
      }
    }
    return false;
  }

  // BUG: sebelumnya cuma resolveBuildingCollision yang dipanggil untuk pemain JALAN KAKI, jadi
  // waktu jalan kaki lewat di samping mobil terparkir atau mobil NPC, tidak ada apa-apa yang
  // menahan -> tembus. Fungsi ini mendorong pemain keluar dari body mobil/NPC (dianggap lingkaran
  // dari atas, sama seperti cara checkVehicleCollisions menghitung tabrakan saat nyetir).
  function resolveVehicleCollisionForWalker(pos, radius){
    vehicles.forEach(function(v){
      if (v.occupied) return; // yang lagi dikendarai (pemain sendiri) jangan dihitung
      var dx = pos.x - v.mesh.position.x, dz = pos.z - v.mesh.position.z;
      var minD = radius + v.def.radius*0.6;
      var d = Math.sqrt(dx*dx+dz*dz);
      if (d < minD){
        if (d < 0.0001){ dx = 1; dz = 0; d = 0.0001; }
        pos.x = v.mesh.position.x + (dx/d)*minD;
        pos.z = v.mesh.position.z + (dz/d)*minD;
      }
    });
    npcCars.forEach(function(nc){
      var dx = pos.x - nc.mesh.position.x, dz = pos.z - nc.mesh.position.z;
      var minD = radius + 2.0;
      var d = Math.sqrt(dx*dx+dz*dz);
      if (d < minD){
        if (d < 0.0001){ dx = 1; dz = 0; d = 0.0001; }
        pos.x = nc.mesh.position.x + (dx/d)*minD;
        pos.z = nc.mesh.position.z + (dz/d)*minD;
      }
    });
    policeCars.forEach(function(pc){
      var dx = pos.x - pc.mesh.position.x, dz = pos.z - pc.mesh.position.z;
      var minD = radius + 2.0;
      var d = Math.sqrt(dx*dx+dz*dz);
      if (d < minD){
        if (d < 0.0001){ dx = 1; dz = 0; d = 0.0001; }
        pos.x = pc.mesh.position.x + (dx/d)*minD;
        pos.z = pc.mesh.position.z + (dz/d)*minD;
      }
    });
  }

  // trees
  function addTree(x,z){
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.3,2,8), new THREE.MeshLambertMaterial({color:0x6b4a2f}));
    trunk.position.set(x, 1, z);
    scene.add(trunk);
    var leafMat = new THREE.MeshStandardMaterial({color:0x2f6f3d, roughness:1, metalness:0});
    [[0,2.6,0,1.6],[.75,2.85,.25,1.15],[-.7,2.8,-.2,1.05],[0,3.45,.15,.9]].forEach(function(c){
      var top = new THREE.Mesh(new THREE.SphereGeometry(c[3],10,8), leafMat);
      top.position.set(x+c[0],c[1],z+c[2]); top.castShadow=true; scene.add(top);
    });
  }
  for (var t=0;t<44;t++){
    var tx = (Math.random()-0.5)*CITY_SIZE*0.9;
    var tz = (Math.random()-0.5)*CITY_SIZE*0.9;
    // BUG LAMA: "Math.abs(tx%40) < 6" cuma ngecek jarak ke kelipatan 40 di BAWAHnya, jadi titik
    // seperti tx=38 (jarak sebenarnya cuma 2 dari jalan di x=40) lolos begitu saja -> pohon
    // tumbuh di tengah jalan. nearRoad() sudah benar ngecek jarak ke jalan terdekat di kedua sumbu.
    if (nearRoad(tx) || nearRoad(tz) || isInsideAnyBuilding(tx, tz, 1.5)) continue;
    addTree(tx, tz);
  }

  // ================= river & runway (open area beyond road grid) =================
  var riverMat = new THREE.MeshLambertMaterial({ color: 0x3a86c8, transparent:true, opacity:0.9 });
  var river = new THREE.Mesh(new THREE.PlaneGeometry(320, 26), riverMat);
  river.rotation.x = -Math.PI/2;
  river.position.set(0, 0.03, -140);
  scene.add(river);

  var runwayMat = new THREE.MeshLambertMaterial({ color: 0x4a4d55 });
  var runway = new THREE.Mesh(new THREE.PlaneGeometry(14, 110), runwayMat);
  runway.rotation.x = -Math.PI/2;
  runway.position.set(140, 0.02, 0);
  scene.add(runway);
  addLineStripV(-55, 55, 140);
  flushLineMarks();

  // ================= new district: pantai (south-west) =================
  var sandMat = new THREE.MeshLambertMaterial({ color: 0xe9d9a3 });
  var beach = new THREE.Mesh(new THREE.PlaneGeometry(95, 95), sandMat);
  beach.rotation.x = -Math.PI/2;
  beach.position.set(-140, 0.02, 140);
  scene.add(beach);
  var seaMat = new THREE.MeshLambertMaterial({ color: 0x3a9fc8, transparent:true, opacity:0.9 });
  var sea = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), seaMat);
  sea.rotation.x = -Math.PI/2;
  sea.position.set(-140, 0.03, 175);
  scene.add(sea);
  function addPalm(x,z){
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.28,3.4,7), new THREE.MeshLambertMaterial({color:0x8a6a3f}));
    trunk.position.set(x, 1.7, z);
    trunk.rotation.z = (Math.random()-0.5)*0.15;
    scene.add(trunk);
    var top = new THREE.Mesh(new THREE.SphereGeometry(1.3,8,6), new THREE.MeshLambertMaterial({color:0x4aa855}));
    top.position.set(x, 3.6, z);
    top.scale.set(1.3,0.6,1.3);
    scene.add(top);
  }
  for (var pp=0; pp<7; pp++){
    addPalm(-140 + (Math.random()-0.5)*70, 120 + (Math.random()-0.5)*40);
  }

  // ================= new district: taman kota (north-east) =================
  var parkMat = new THREE.MeshLambertMaterial({ color: 0x7fc46a });
  var park = new THREE.Mesh(new THREE.PlaneGeometry(85, 85), parkMat);
  park.rotation.x = -Math.PI/2;
  park.position.set(140, 0.02, -140);
  scene.add(park);
  var fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(4,4,0.5,16), new THREE.MeshLambertMaterial({color:0xb9b9b9}));
  fountainBase.position.set(140, 0.25, -140);
  scene.add(fountainBase);
  var fountainWater = new THREE.Mesh(new THREE.CylinderGeometry(3.2,3.2,0.15,16), new THREE.MeshBasicMaterial({color:0x6fd0ff}));
  fountainWater.position.set(140, 0.52, -140);
  scene.add(fountainWater);
  for (var pk=0; pk<8; pk++){
    var ang = Math.random()*Math.PI*2, rad = 12+Math.random()*28;
    addTree(140 + Math.cos(ang)*rad, -140 + Math.sin(ang)*rad);
  }

  // ================= street lamps =================
  var lampLights = [];
  var lampBulbs = [];
  function addLamp(x, z, withLight){
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,3.2,6), new THREE.MeshLambertMaterial({color:0x333333}));
    pole.position.set(x, 1.6, z);
    scene.add(pole);
    var bulbMat = new THREE.MeshBasicMaterial({ color: 0x554422 });
    var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22,8,8), bulbMat);
    bulb.position.set(x, 3.25, z);
    scene.add(bulb);
    lampBulbs.push(bulb);
    if (withLight){
      var pl = new THREE.PointLight(0xffcf80, 0, 14, 2);
      pl.position.set(x, 3.2, z);
      scene.add(pl);
      lampLights.push(pl);
    }
  }
  // BUG LAMA: jarak offset dari pusat jalan cuma 2-4 unit, padahal lebar jalan (addRoad) itu 9
  // (setengah lebar 4.5) -> tiang lampu berdiri PERSIS DI ATAS ASPAL, di tengah jalan/perempatan.
  // Sekarang offset dinaikkan jadi 7 di kedua sumbu (>4.5) supaya lampu berdiri di trotoar,
  // di luar badan jalan, tapi tetap dekat perempatan seperti aslinya.
  var lampSpots = [[-47,7],[47,7],[-47,-33],[47,-33],[7,-47],[-33,-47],[7,47],[-33,47],[-7,80],[7,-80],[-7,-120],[7,120],[120,7],[-120,-7]];
  lampSpots.forEach(function(p, idx){ addLamp(p[0], p[1], idx < 8); });

  // ================= player =================
  var player = new THREE.Group();
  var pBody = new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,1.1,8), new THREE.MeshLambertMaterial({color:0xff5d3b}));
  pBody.position.y = 1.15;
  player.add(pBody);
  var pHead = new THREE.Mesh(new THREE.SphereGeometry(0.32,10,10), new THREE.MeshLambertMaterial({color:0xffd7b0}));
  pHead.position.y = 1.85;
  player.add(pHead);
  var limbMat = new THREE.MeshLambertMaterial({color:0xff5d3b});
  var legMat = new THREE.MeshLambertMaterial({color:0x2b2d33});
  function makeLimbPivot(geo, mat, x, y, halfLen){
    var pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -halfLen;
    pivot.add(mesh);
    player.add(pivot);
    return pivot;
  }
  var pArmL = makeLimbPivot(new THREE.CylinderGeometry(0.1,0.1,0.55,6), limbMat, -0.5, 1.55, 0.275);
  var pArmR = makeLimbPivot(new THREE.CylinderGeometry(0.1,0.1,0.55,6), limbMat, 0.5, 1.55, 0.275);
  var pLegL = makeLimbPivot(new THREE.CylinderGeometry(0.13,0.13,0.62,6), legMat, -0.2, 0.62, 0.31);
  var pLegR = makeLimbPivot(new THREE.CylinderGeometry(0.13,0.13,0.62,6), legMat, 0.2, 0.62, 0.31);
  player.position.set(0, 0, 14);
  scene.add(player);

  var playerState = { speed: 4.2, accel: 10, decel: 14, turnSpeed: 2.6, curSpeed: 0 };
  var walkCycle = 0;
  var PLAYER_RADIUS = 0.5;

  // ================= karakter 3D: RobotExpressive (CC0 — Tomás Laulhé / Don McCurdy) =================
  // Model ini punya 14 animasi (Idle, Walking, Running, Jump, ThumbsUp, Dance, No, Wave, ...) dan 3 ekspresi wajah.
  // Selama model belum selesai dimuat, karakter sederhana di atas tetap dipakai sebagai cadangan.
  var robotGLTF = null, robotSize = null;
  var playerActor = null;

  // "Maju" untuk objek di dunia ini = sumbu -Z, jadi yaw untuk menghadap (dx,dz) dihitung begini:
  function yawToward(dx, dz){ return Math.atan2(-dx, -dz); }
  function angleDelta(from, to){
    var d = (to - from) % (Math.PI*2);
    if (d > Math.PI) d -= Math.PI*2;
    if (d < -Math.PI) d += Math.PI*2;
    return d;
  }
  function b64ToBuffer(b64){
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // ================= aksesoris karakter: topi & syal (menarik & serbaguna dari segala arah) =================
  function makeCap(color){
    var g = new THREE.Group();
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
      new THREE.MeshLambertMaterial({ color: color })
    );
    g.add(dome);
    var brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.015, 16),
      new THREE.MeshLambertMaterial({ color: color })
    );
    brim.position.y = -0.005;
    g.add(brim);
    var button = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 6, 6),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    button.position.y = 0.15;
    g.add(button);
    return g;
  }
  function makeScarf(color){
    var g = new THREE.Group();
    var band = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.035, 8, 16),
      new THREE.MeshLambertMaterial({ color: color })
    );
    band.rotation.x = Math.PI / 2;
    g.add(band);
    var tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.22, 0.02),
      new THREE.MeshLambertMaterial({ color: color })
    );
    tail.position.set(0, -0.16, 0.12);
    g.add(tail);
    return g;
  }
  var _accM = new THREE.Matrix4();
  function syncAccessory(root, bone, mesh){
    if (!bone || !mesh) return;
    _accM.copy(root.matrixWorld).invert().multiply(bone.matrixWorld);
    _accM.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.scale.setScalar(1);
  }

  function makeActor(o){
    var model = THREE.cloneSkinned(robotGLTF.scene);
    var head = null;
    model.traverse(function(n){
      if (!n.isMesh) return;
      n.castShadow = true;
      n.frustumCulled = false;               // tulang bergerak, bounding box bawaan tidak akurat
      n.material = n.material.clone();       // supaya tiap karakter boleh punya warna sendiri
      if (n.material.name === 'Main') n.material.color.setHex(o.tint);
      if (n.morphTargetDictionary) head = n;
    });
    var s = o.height / robotSize.h;
    model.scale.setScalar(s);
    model.position.y = -robotSize.minY * s;
    model.rotation.y = Math.PI;              // model menghadap +Z, dunia ini maju ke -Z
    var root = new THREE.Group();
    root.add(model);
    var mixer = new THREE.AnimationMixer(model);
    var actions = {};
    robotGLTF.animations.forEach(function(clip){ actions[clip.name] = mixer.clipAction(clip); });
    var a = { root:root, model:model, mixer:mixer, actions:actions, head:head,
              base:'Idle', baseScale:1, current:null, once:null, faceIdx:-1, faceUntil:0, greeted:false };
    // pasang aksesoris (topi & syal) yang otomatis mengikuti tulang leher/kepala tiap frame
    if (o.cap || o.scarf){
      var headBone = null, neckBone = null;
      model.traverse(function(n){
        if (!n.isBone) return;
        if (!headBone && /head/i.test(n.name)) headBone = n;
        if (!neckBone && /neck/i.test(n.name)) neckBone = n;
      });
      if (o.cap && headBone){
        a.capBone = headBone;
        a.capMesh = makeCap(o.cap);
        root.add(a.capMesh);
      }
      if (o.scarf && neckBone){
        a.scarfBone = neckBone;
        a.scarfMesh = makeScarf(o.scarf);
        root.add(a.scarfMesh);
      }
    }
    // setelah animasi sekali-jalan selesai, kembali ke animasi dasar (Idle / Walking)
    mixer.addEventListener('finished', function(e){
      if (e.action !== a.once) return;
      a.once = null;
      var b = a.actions[a.base];
      if (!b) return;
      b.reset(); b.timeScale = a.baseScale; b.setEffectiveWeight(1); b.fadeIn(0.25).play();
      e.action.fadeOut(0.25);
      a.current = b;
    });
    return a;
  }
  function actorBase(a, name, timeScale){
    if (!a) return;
    var next = a.actions[name];
    if (!next) return;
    a.base = name; a.baseScale = timeScale || 1;
    if (a.once) return;                       // sedang emote; nanti kembali ke sini
    if (a.current === next){ next.timeScale = a.baseScale; return; }
    next.reset(); next.timeScale = a.baseScale; next.setEffectiveWeight(1); next.fadeIn(0.22).play();
    if (a.current) a.current.fadeOut(0.22);
    a.current = next;
  }
  function actorOnce(a, name, reps){
    if (!a) return;
    var act = a.actions[name];
    if (!act) return;
    if (a.once && a.once !== act) a.once.fadeOut(0.15);
    act.reset(); act.timeScale = 1;
    act.setLoop(reps > 1 ? THREE.LoopRepeat : THREE.LoopOnce, reps || 1);
    act.clampWhenFinished = true;
    act.setEffectiveWeight(1); act.fadeIn(0.15).play();
    if (a.current && a.current !== act) a.current.fadeOut(0.15);
    a.current = act; a.once = act;
  }
  function actorFace(a, name, secs){        // 'Sad' | 'Surprised' | 'Angry'
    if (!a || !a.head) return;
    var idx = a.head.morphTargetDictionary[name];
    if (idx === undefined) return;
    a.faceIdx = idx; a.faceUntil = performance.now()/1000 + (secs || 1.6);
  }
  function actorUpdate(a, dt){
    a.mixer.update(dt);
    if (a.capBone || a.scarfBone){
      a.model.updateMatrixWorld(true);
      if (a.capBone) syncAccessory(a.root, a.capBone, a.capMesh);
      if (a.scarfBone) syncAccessory(a.root, a.scarfBone, a.scarfMesh);
    }
    if (a.head){
      var inf = a.head.morphTargetInfluences, now = performance.now()/1000;
      for (var i=0;i<inf.length;i++){
        var target = (i === a.faceIdx && now < a.faceUntil) ? 1 : 0;
        inf[i] += (target - inf[i]) * Math.min(1, dt*10);
      }
    }
  }

  function attachRobots(){
    // 1) pemain: ganti karakter sederhana dengan robot
    playerActor = makeActor({ height: 1.9, tint: BK.robot, cap: 0x1a1a2e, scarf: 0xff477e });
    playerActor.root.scale.setScalar(1.02);
    player.children.slice().forEach(function(c){ c.visible = false; });
    player.add(playerActor.root);
    // soft contact shadow under the character
    var playerShadow = new THREE.Mesh(
      new THREE.CircleGeometry(.58,24),
      new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.22,depthWrite:false})
    );
    playerShadow.rotation.x=-Math.PI/2; playerShadow.position.y=.018; playerShadow.scale.y=.45;
    player.add(playerShadow);
    actorBase(playerActor, 'Idle', 1);
    // 2) penjaga di tiap kristal coding
    LANDMARKS.forEach(function(lm, i){
      var g = makeActor({ height: 2.0, tint: LM_COLORS[i % LM_COLORS.length] });
      g.root.position.set(lm.x + 2.8, 0, lm.z + 1.6);
      scene.add(g.root);
      actorBase(g, 'Idle', 1);
      lm.guardian = g;
    });
    // 3) pejalan kaki kota
    pedestrians.forEach(function(p, i){
      var wantCap = (i % 2 === 0), wantScarf = (i % 3 !== 0);
      var a = makeActor({
        height: 1.6,
        tint: pedColors[i % pedColors.length],
        cap: wantCap ? ACC_COLORS[(i * 2) % ACC_COLORS.length] : null,
        scarf: wantScarf ? ACC_COLORS[(i * 2 + 3) % ACC_COLORS.length] : null
      });
      p.mesh.children.slice().forEach(function(c){ c.visible = false; });
      p.mesh.add(a.root);
      actorBase(a, 'Walking', 0.7 + Math.random()*0.3);
      var w = a.actions.Walking;
      if (w) w.time = Math.random() * w.getClip().duration;
      p.actor = a;
    });
  }
  function loadRobots(){
    if (!THREE.GLTFLoader) return;
    fetch('robot.glb')
      .then(function(res){
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function(buf){
        new THREE.GLTFLoader().parse(buf, '', function(gltf){
          robotGLTF = gltf;
          var box = new THREE.Box3().setFromObject(gltf.scene, true);
          var size = new THREE.Vector3(); box.getSize(size);
          robotSize = { h: size.y, minY: box.min.y };
          attachRobots();
        }, function(err){ console.warn('Robot 3D gagal dimuat, memakai karakter sederhana', err); });
      })
      .catch(function(err){ console.warn('Robot 3D (robot.glb) gagal di-fetch, memakai karakter sederhana', err); });
  }

  // animasi pemain mengikuti kecepatan jalan
  function updatePlayerAnim(){
    if (!playerActor) return;
    var sp = Math.abs(playerState.curSpeed);
    if (sp < 0.08) actorBase(playerActor, 'Idle', 1);
    else if (sp > 3.1) actorBase(playerActor, 'Running', Math.min(2.0, sp/4.2 + 0.3));
    else actorBase(playerActor, 'Walking', Math.max(0.7, sp/2.4));
  }
  function updateActors(realDt){
    if (playerActor && player.visible){ updatePlayerAnim(); actorUpdate(playerActor, realDt); }
    LANDMARKS.forEach(function(lm){
      var g = lm.guardian;
      if (!g) return;
      var dx = focus.x - g.root.position.x, dz = focus.z - g.root.position.z, d2 = dx*dx + dz*dz;
      g.root.visible = d2 < 90*90;
      if (!g.root.visible) return;
      if (d2 < 30*30){
        g.root.rotation.y += angleDelta(g.root.rotation.y, yawToward(dx, dz)) * Math.min(1, realDt*5);
      }
      if (d2 < 15*15 && !g.greeted){ g.greeted = true; actorOnce(g, 'Wave'); }
      if (d2 > 45*45) g.greeted = false;
      actorUpdate(g, realDt);
    });
  }

  // ================= vehicle builders =================
  // Mobile-safe rounded detail primitive. The bundled Three build intentionally
  // exposes core geometries only, so avoid Shape/ExtrudeGeometry here.
  function roundedBox(w,h,d,mat,bevel){
    var geo = new THREE.BoxGeometry(w,h,d,2,2,2);
    var mesh = new THREE.Mesh(geo,mat);
    mesh.userData.softBox = true;
    return mesh;
  }
  function wheelSet(g, positions){
    var tireMat = new THREE.MeshStandardMaterial({color:0x111214,roughness:0.8,metalness:0.05});
    var rimMat = new THREE.MeshStandardMaterial({color:0x8b9198,roughness:0.28,metalness:0.8});
    var hubMat = new THREE.MeshStandardMaterial({color:0x25282c,roughness:0.35,metalness:0.7});
    positions.forEach(function(p){
      var wheel = new THREE.Group();
      var tire = new THREE.Mesh(new THREE.TorusGeometry(0.34,0.105,12,24),tireMat);
      tire.rotation.y = Math.PI/2;
      wheel.add(tire);
      var rim = new THREE.Mesh(new THREE.CylinderGeometry(0.23,0.23,0.12,20),rimMat);
      rim.rotation.z = Math.PI/2;
      wheel.add(rim);
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.14,16),hubMat);
      hub.rotation.z = Math.PI/2;
      wheel.add(hub);
      wheel.position.set(p[0],p[1],p[2]);
      g.add(wheel);
    });
  }
  function loftedCarBody(material, sport){
    // Smooth fallback body built only from geometries available in the bundled build.
    var body = new THREE.Mesh(new THREE.SphereGeometry(1,24,12), material);
    body.scale.set(1.06,0.34,2.02);
    return body;
  }
  function makeCar(color, scaleFactor){
    var g=new THREE.Group();
    var paint=new THREE.MeshStandardMaterial({color:color,roughness:0.18,metalness:0.55});
    var paintDark=new THREE.MeshStandardMaterial({color:0x101316,roughness:0.24,metalness:0.25});
    var glass=new THREE.MeshStandardMaterial({color:0x101c27,roughness:0.08,metalness:0.18,transparent:true,opacity:0.82});
    var chrome=new THREE.MeshStandardMaterial({color:0xd6dbe0,roughness:0.16,metalness:0.9});
    var tireMat=new THREE.MeshStandardMaterial({color:0x090a0b,roughness:0.82,metalness:0.02});
    var redLamp=new THREE.MeshStandardMaterial({color:0x9d0710,emissive:0x5b0000,emissiveIntensity:0.8,roughness:0.18});
    var whiteLamp=new THREE.MeshStandardMaterial({color:0xf4fbff,emissive:0x92b6c9,emissiveIntensity:1.2,roughness:0.12});

    var body=loftedCarBody(paint);
    body.position.y=0.55; g.add(body); g.userData.bodyMesh=body; g.userData.baseColor=color;

    // Lower side skirts and bumpers
    var skirt=roundedBox(1.94,0.18,3.35,paintDark,0.08); skirt.position.y=0.37; g.add(skirt);
    var frontB=roundedBox(1.78,0.16,0.18,paintDark,0.06); frontB.position.set(0,0.47,2.00); g.add(frontB);
    var rearB=roundedBox(1.78,0.16,0.18,paintDark,0.06); rearB.position.set(0,0.47,-2.00); g.add(rearB);

    // Hood and trunk are tapered slabs, giving the silhouette an automotive profile.
    var hood=roundedBox(1.70,0.12,1.08,paint,0.08); hood.position.set(0,0.83,1.18); g.add(hood);
    var trunk=roundedBox(1.62,0.13,0.72,paint,0.08); trunk.position.set(0,0.81,-1.43); g.add(trunk);

    // Sloped cabin fallback: keep it simple and mobile-safe; the real GLB replaces it when loaded.
    var cabin=roundedBox(1.45,0.62,1.70,glass,0.05);
    cabin.position.set(0,0.91,-0.08);
    cabin.rotation.x=0.02;
    g.add(cabin);

    function darkMaterial(m){ return m; }
    // Window frames / pillars and glass panels
    var pillarMat=paintDark;
    [-0.55,0.55].forEach(function(x){
      var p=roundedBox(0.055,0.56,1.62,pillarMat,0.025); p.position.set(x,1.13,-0.08); g.add(p);
    });
    var windshield=roundedBox(1.22,0.40,0.035,glass,0.025); windshield.position.set(0,1.18,0.78); windshield.rotation.x=-0.16; g.add(windshield);
    var rearWin=roundedBox(1.18,0.36,0.035,glass,0.025); rearWin.position.set(0,1.16,-0.92); rearWin.rotation.x=0.18; g.add(rearWin);
    [-0.81,0.81].forEach(function(x){
      var side=roundedBox(0.025,0.34,1.32,glass,0.018); side.position.set(x,1.15,-0.08); g.add(side);
    });

    // Doors, handles and subtle body crease
    [-1,1].forEach(function(side){
      var crease=roundedBox(0.025,0.035,1.55,chrome,0.01); crease.position.set(side*1.035,0.69,-0.12); g.add(crease);
      var handle1=roundedBox(0.06,0.035,0.22,chrome,0.02); handle1.position.set(side*1.045,0.91,0.38); g.add(handle1);
      var handle2=roundedBox(0.06,0.035,0.22,chrome,0.02); handle2.position.set(side*1.045,0.91,-0.48); g.add(handle2);
    });

    // Grille, headlights and rear lights
    var grille=roundedBox(0.72,0.18,0.045,paintDark,0.06); grille.position.set(0,0.61,2.03); g.add(grille);
    [-0.64,0.64].forEach(function(x){
      var h=roundedBox(0.42,0.16,0.05,whiteLamp,0.06); h.position.set(x,0.72,2.04); g.add(h);
      var t=roundedBox(0.46,0.15,0.05,redLamp,0.05); t.position.set(x,0.72,-2.04); g.add(t);
    });
    // Mirrors
    [-1,1].forEach(function(x){ var m=roundedBox(0.18,0.11,0.30,paint,0.06); m.position.set(x*0.91,1.00,0.62); g.add(m); });

    // Wheels with visible brake discs/calipers
    [[-1.02,0.40,1.28],[1.02,0.40,1.28],[-1.02,0.40,-1.28],[1.02,0.40,-1.28]].forEach(function(p){
      var wg=new THREE.Group();
      var tire=new THREE.Mesh(new THREE.TorusGeometry(0.35,0.12,14,28),tireMat); tire.rotation.y=Math.PI/2; wg.add(tire);
      var rim=new THREE.Mesh(new THREE.CylinderGeometry(0.245,0.245,0.13,24),chrome); rim.rotation.z=Math.PI/2; wg.add(rim);
      var disc=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,0.135,20),paintDark); disc.rotation.z=Math.PI/2; wg.add(disc);
      wg.position.set(p[0],p[1],p[2]); g.add(wg);
    });
    g.scale.setScalar(scaleFactor||1);
    return g;
  }
  function makeBike(color){
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 1.9), new THREE.MeshLambertMaterial({color:color}));
    body.position.y = 0.55;
    g.add(body);
    g.userData.bodyMesh = body;
    g.userData.baseColor = color;
    var seat = new THREE.Mesh(new THREE.BoxGeometry(0.35,0.2,0.6), new THREE.MeshLambertMaterial({color:0x1a1a1a}));
    seat.position.set(0,0.9,0.2);
    g.add(seat);
    var wheelGeo = new THREE.TorusGeometry(0.45,0.08,8,16);
    var wheelMat = new THREE.MeshLambertMaterial({color:0x1a1a1a});
    [0.9,-0.9].forEach(function(zp){
      var wh = new THREE.Mesh(wheelGeo, wheelMat);
      wh.rotation.y = Math.PI/2;
      wh.position.set(0,0.45,zp);
      g.add(wh);
    });
    return g;
  }
  function makeTruck(color){
    var g = new THREE.Group();
    var cab = new THREE.Mesh(new THREE.BoxGeometry(2.1,1.3,1.6), new THREE.MeshLambertMaterial({color:color}));
    cab.position.set(0,0.95,1.6);
    g.add(cab);
    g.userData.bodyMesh = cab;
    g.userData.baseColor = color;
    var bed = new THREE.Mesh(new THREE.BoxGeometry(2.1,1.0,3.0), new THREE.MeshLambertMaterial({color:0x555a63}));
    bed.position.set(0,0.75,-1.0);
    g.add(bed);
    wheelSet(g, [[-1.1,0.45,1.8],[1.1,0.45,1.8],[-1.1,0.45,-0.4],[1.1,0.45,-0.4],[-1.1,0.45,-1.8],[1.1,0.45,-1.8]]);
    return g;
  }
  function makePlane(color){
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.5,3.6,10), new THREE.MeshLambertMaterial({color:color}));
    body.rotation.x = Math.PI/2;
    body.position.y = 0.9;
    g.add(body);
    g.userData.bodyMesh = body;
    g.userData.baseColor = color;
    var wing = new THREE.Mesh(new THREE.BoxGeometry(6.5,0.15,1.0), new THREE.MeshLambertMaterial({color:0xdedede}));
    wing.position.set(0,0.95,0.1);
    g.add(wing);
    var tailWing = new THREE.Mesh(new THREE.BoxGeometry(2.0,0.12,0.7), new THREE.MeshLambertMaterial({color:0xdedede}));
    tailWing.position.set(0,1.25,-1.6);
    g.add(tailWing);
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.12,1.0,0.9), new THREE.MeshLambertMaterial({color:color}));
    fin.position.set(0,1.6,-1.6);
    g.add(fin);
    wheelSet(g, [[-0.8,0.3,0.6],[0.8,0.3,0.6],[0,0.3,-1.2]]);
    return g;
  }
  function makeBoat(color){
    var g = new THREE.Group();
    var hull = new THREE.Mesh(new THREE.BoxGeometry(1.8,0.7,4.2), new THREE.MeshLambertMaterial({color:color}));
    hull.position.y = 0.45;
    g.add(hull);
    g.userData.bodyMesh = hull;
    g.userData.baseColor = color;
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.2,0.7,1.2), new THREE.MeshLambertMaterial({color:0xffffff}));
    cabin.position.set(0,1.0,0.6);
    g.add(cabin);
    return g;
  }

  // ================= REAL GLB VEHICLE SYSTEM =================
  // Uses a CC0 real 3D hatchback/sedan asset instead of the procedural box car.
  // The game keeps the procedural car as an instant fallback while the GLB loads.
  var REAL_CAR_URL = 'https://cdn.3dassets.dev/assets/35645/v1/model.glb';
  var realCarGLTF = null;
  var realCarReady = false;
  var realCarMixers = [];

  function prepareRealCarScene(src){
    var model = THREE.cloneSkinned ? THREE.cloneSkinned(src) : src.clone(true);
    model.traverse(function(n){
      if(n.isMesh){
        n.castShadow = true;
        n.receiveShadow = true;
        if(n.material){
          if(Array.isArray(n.material)) n.material = n.material.map(function(m){ return m.clone ? m.clone() : m; });
          else if(n.material.clone) n.material = n.material.clone();
          var mm = Array.isArray(n.material) ? n.material : [n.material];
          mm.forEach(function(m){
            if(!m) return;
            // Some remote GLB assets lose their original texture references in mobile/web
            // contexts. Keep the PBR material but give it a visible neutral base instead
            // of letting the whole vehicle render as flat white.
            if(m.color && m.color.r > 0.97 && m.color.g > 0.97 && m.color.b > 0.97){
              m.color.set(0x777777);
            }
            if('metalness' in m) m.metalness = Math.min(Math.max(m.metalness, 0.05), 0.65);
            if('roughness' in m) m.roughness = Math.max(0.28, Math.min(m.roughness, 0.72));
            m.needsUpdate = true;
          });
        }
      }
    });
    var box = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    // Normalize to roughly a 4.4m street car in our game world.
    var targetLength = 4.35;
    var scale = targetLength / Math.max(size.x, size.z);
    model.scale.setScalar(scale);
    box.setFromObject(model);
    var center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
    model.position.y += 0.04;
    model.userData.realVehicle = true;
    return model;
  }

  function tintRealCar(model, color){
    // Keep glass/rubber/chrome materials intact; tint only likely paint materials.
    model.traverse(function(n){
      if(!n.isMesh || !n.material) return;
      var mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach(function(m){
        if(!m || !m.color) return;
        var nm = String(n.name || m.name || '').toLowerCase();
        if(/glass|window|tire|wheel|rubber|chrome|metal|light|lamp|brake/.test(nm)) return;
        // Strong enough tint for mobile browsers where the remote GLB may arrive
        // without its original paint texture.
        var c = new THREE.Color(color);
        if(m.map) m.color.lerp(c, 0.42);
        else m.color.lerp(c, 0.78);
        if('metalness' in m) m.metalness = Math.max(m.metalness, 0.15);
        if('roughness' in m) m.roughness = Math.min(m.roughness, 0.34);
      });
    });
  }

  function installRealCar(v, color){
    if(!realCarGLTF || !v || !v.mesh) return;
    // Remove only the current vehicle visual; keep the vehicle wrapper used by gameplay.
    while(v.mesh.children.length) v.mesh.remove(v.mesh.children[0]);
    var model = prepareRealCarScene(realCarGLTF.scene);
    tintRealCar(model, color || 0x2f6fff);
    model.rotation.y = 0;
    v.mesh.add(model);
    v.mesh.userData.bodyMesh = model;
    v.mesh.userData.baseColor = color || 0x2f6fff;
    v.mesh.userData.origColor = color || 0x2f6fff;
    v.realModel = model;
    if(realCarGLTF.animations && realCarGLTF.animations.length){
      var mixer = new THREE.AnimationMixer(model);
      realCarGLTF.animations.forEach(function(clip){ mixer.clipAction(clip).play(); });
      realCarMixers.push(mixer);
      v.realMixer = mixer;
    }
  }

  function loadRealCarAsset(){
    if(!THREE.GLTFLoader) return;
    var loader = new THREE.GLTFLoader();
    loader.load(REAL_CAR_URL, function(gltf){
      realCarGLTF = gltf;
      // Normalize materials immediately so the car does not appear as a white silhouette
      // when the source asset has missing/unsupported paint textures.
      gltf.scene.traverse(function(n){
        if(!n.isMesh || !n.material) return;
        var arr = Array.isArray(n.material) ? n.material : [n.material];
        arr.forEach(function(m){ if(m && m.color && m.color.r > 0.97 && m.color.g > 0.97 && m.color.b > 0.97) m.color.set(0x666666); });
      });
      realCarReady = true;
      if(typeof vehicles !== 'undefined') vehicles.forEach(function(v){
        if(v && v.def && (v.def.name === 'Sedan' || v.def.name === 'Sport Car')){
          installRealCar(v, v.def.name === 'Sport Car' ? 0x244dff : 0xc92e32);
        }
      });
      console.log('Jalan-Jalan City: real GLB vehicle loaded');
    }, undefined, function(err){
      console.warn('Real GLB vehicle failed; keeping fallback car.', err);
    });
  }

  var VEHICLE_DEFS = [
    { name: "Sedan", build: function(){ return makeCar(0xd0342c, 1.0); }, speed: 11, turnSpeed: 2.2, enterDist: 2.6, radius: 2.4, domain:"land", accel: 9, decel: 12, sound:{wave:'sawtooth', base:55, range:150, sub:true} },
    { name: "Sport Car", build: function(){ return makeCar(0x2b6cff, 0.95); }, speed: 16, turnSpeed: 2.6, enterDist: 2.6, radius: 2.3, domain:"land", accel: 15, decel: 14, sound:{wave:'sawtooth', base:80, range:280, sub:true} },
    { name: "Motor", build: function(){ return makeBike(0x1a1a1a); }, speed: 9, turnSpeed: 3.2, enterDist: 1.8, radius: 1.2, domain:"land", accel: 12, decel: 10, sound:{wave:'square', base:100, range:320, sub:false} },
    { name: "Truk", build: function(){ return makeTruck(0x3d8b4c); }, speed: 7, turnSpeed: 1.5, enterDist: 3.2, radius: 2.8, domain:"land", accel: 4, decel: 6, sound:{wave:'sawtooth', base:35, range:90, sub:true} },
    { name: "Pesawat", build: function(){ return makePlane(0xffffff); }, speed: 20, turnSpeed: 1.6, enterDist: 3.2, radius: 3.2, domain:"air", accel: 5, decel: 3, sound:{wave:'sawtooth', base:70, range:160, sub:true} },
    { name: "Perahu", build: function(){ return makeBoat(0xdda43a); }, speed: 8, turnSpeed: 1.8, enterDist: 3.0, radius: 2.4, domain:"water", accel: 3, decel: 5, sound:{wave:'triangle', base:45, range:70, sub:false} }
  ];

  var vehicles = [];
  function nearestRoadCoord(v){
    var best = roadPositions[0];
    roadPositions.forEach(function(p){ if (Math.abs(p - v) < Math.abs(best - v)) best = p; });
    return best;
  }
  function spawnVehicle(def, x, z){
    if (isInsideAnyBuilding(x, z, 2)) x = nearestRoadCoord(x) + 3.5;   // jangan muncul di dalam gedung
    var inner = def.build();
    // PERBAIKAN: moncong model menghadap +Z, tetapi gerak maju di game = -Z (pesawat dulu terbang mundur / ekor duluan)
    inner.rotation.y = Math.PI;
    var mesh = new THREE.Group();
    mesh.add(inner);
    mesh.userData.bodyMesh = inner.userData.bodyMesh;
    mesh.userData.baseColor = inner.userData.baseColor;
    mesh.userData.origColor = inner.userData.baseColor;
    mesh.traverse(function(n){ if (n.isMesh) n.castShadow = true; });
    mesh.position.set(x, 0, z);
    mesh.rotation.y = Math.random()*Math.PI*2;
    scene.add(mesh);
    var v = { def: def, mesh: mesh, occupied:false, health:100 };
    vehicles.push(v);
    return v;
  }
  spawnVehicle(VEHICLE_DEFS[0], 10, 6);
  spawnVehicle(VEHICLE_DEFS[0], -20, -8);
  spawnVehicle(VEHICLE_DEFS[1], -10, 6);
  spawnVehicle(VEHICLE_DEFS[1], 22, 20);
  spawnVehicle(VEHICLE_DEFS[2], 10, -8);
  spawnVehicle(VEHICLE_DEFS[2], -22, -20);
  spawnVehicle(VEHICLE_DEFS[3], 0, 30);
  spawnVehicle(VEHICLE_DEFS[3], 30, 0);
  spawnVehicle(VEHICLE_DEFS[4], 140, -30);
  spawnVehicle(VEHICLE_DEFS[5], -30, -140);
  spawnVehicle(VEHICLE_DEFS[5], 40, -140);
  spawnVehicle(VEHICLE_DEFS[0], 100, 90);
  spawnVehicle(VEHICLE_DEFS[1], -90, -100);
  spawnVehicle(VEHICLE_DEFS[3], -100, 90);
  spawnVehicle(VEHICLE_DEFS[2], 100, -90);
  loadRealCarAsset();

  // ================= NPC pedestrians =================
  var pedestrians = [];
  var pedColors = [0xff477e, 0x00d4ff, 0xffd23f, 0x7c4dff, 0x2ee6a6, 0xff8c42, 0x4ecdc4];
  var ACC_COLORS = [0xff477e, 0x22d3ee, 0xffd23f, 0x7c4dff, 0x2ee6a6, 0xff8c42, 0xf72585, 0x06d6a0];
  function randOpenSpot(){
    var x, z, tries = 0;
    do {
      x = (Math.random()-0.5)*CITY_SIZE*0.85;
      z = (Math.random()-0.5)*CITY_SIZE*0.85;
      tries++;
    } while (isInsideAnyBuilding(x, z, 1.0) && tries < 20);
    return { x:x, z:z };
  }
  for (var pcount=0; pcount<16; pcount++){
    var g = new THREE.Group();
    var pedMat = new THREE.MeshLambertMaterial({color:pedColors[pcount%pedColors.length]});
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.24,0.28,0.75,8), pedMat);
    body.position.y = 1.05;
    g.add(body);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.22,8,8), new THREE.MeshLambertMaterial({color:0xffd7b0}));
    head.position.y = 1.55;
    g.add(head);
    // Sedikit lengan & kaki supaya siluetnya kelihatan orang, bukan cuma "boneka salju"
    // -- dipakai sebentar sambil menunggu model robot.glb selesai dimuat (lihat loadRobots()).
    var limbMatPed = new THREE.MeshLambertMaterial({color:0x2b2d33});
    [-0.16,0.16].forEach(function(lx){
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.62,6), limbMatPed);
      leg.position.set(lx, 0.31, 0);
      g.add(leg);
    });
    [-0.34,0.34].forEach(function(ax){
      var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.55,6), pedMat);
      arm.position.set(ax, 1.05, 0);
      g.add(arm);
    });
    var spot = randOpenSpot();
    g.position.set(spot.x, 0, spot.z);
    scene.add(g);
    pedestrians.push({ mesh:g, target: randOpenSpot(), speed: 1.0 + Math.random()*0.8 });
  }

  // ================= NPC vehicles (patrol road grid) =================
  var npcCars = [];
  var gridPts = roadPositions;
  function snapToGrid(v){
    var best = gridPts[0], bd = Infinity;
    for (var i=0;i<gridPts.length;i++){ var d = Math.abs(v-gridPts[i]); if (d<bd){ bd=d; best=gridPts[i]; } }
    return best;
  }
  // BUG LAMA: memilih x DAN z random sekaligus -> target sering di perempatan lain yang tidak
  // segaris, jadi NPC/polisi jalan LURUS DIAGONAL memotong kota (lewat trotoar, taman, bahkan
  // gedung) alih-alih tetap di jalan raya. Sekarang, kalau posisi sekarang (curX/curZ) diberikan,
  // cuma SATU sumbu yang berubah setiap kali ganti tujuan (persis seperti mobil belok di
  // perempatan lalu lurus di jalan yang sama), jadi rutenya selalu nempel di grid jalan.
  function randomWaypoint(curX, curZ){
    if (curX === undefined || curZ === undefined){
      return { x: gridPts[Math.floor(Math.random()*gridPts.length)], z: gridPts[Math.floor(Math.random()*gridPts.length)] };
    }
    var sx = snapToGrid(curX), sz = snapToGrid(curZ);
    var changeX = Math.random() < 0.5;
    if (changeX){
      var choicesX = gridPts.filter(function(g){ return g !== sx; });
      return { x: choicesX[Math.floor(Math.random()*choicesX.length)], z: sz };
    } else {
      var choicesZ = gridPts.filter(function(g){ return g !== sz; });
      return { x: sx, z: choicesZ[Math.floor(Math.random()*choicesZ.length)] };
    }
  }
  var npcColors = [0xe0c341, 0x41c3e0, 0xe07a41, 0x8de041];
  for (var nc=0; nc<7; nc++){
    var wp = randomWaypoint();
    var mesh = makeCar(npcColors[nc % npcColors.length], 1.0);
    mesh.position.set(wp.x, 0, wp.z);
    scene.add(mesh);
    // target ambil satu sumbu dari wp (posisi spawn) supaya perjalanan pertama tetap di jalan
    npcCars.push({ mesh:mesh, target: randomWaypoint(wp.x, wp.z), speed: 5 + Math.random()*3 });
  }

  function makePolice(){
    var g = makeCar(0xf2f2f2, 1.0);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.22, 4.02), new THREE.MeshLambertMaterial({color:0x1e5fd6}));
    stripe.position.y = 0.6;
    g.add(stripe);
    var barBase = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.14,0.4), new THREE.MeshLambertMaterial({color:0x222222}));
    barBase.position.set(0,1.36,-0.2);
    g.add(barBase);
    var redLamp = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.16,0.32), new THREE.MeshBasicMaterial({color:0xff2b3a}));
    redLamp.position.set(-0.24,1.46,-0.2);
    g.add(redLamp);
    var blueLamp = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.16,0.32), new THREE.MeshBasicMaterial({color:0x2b6cff}));
    blueLamp.position.set(0.24,1.46,-0.2);
    g.add(blueLamp);
    g.userData.redLamp = redLamp;
    g.userData.blueLamp = blueLamp;
    return g;
  }

  // ================= police patrol & chase =================
  var policeCars = [];
  // BUG LAMA: [60,60] dkk bukan titik jalan (roadPositions cuma kelipatan 40), jadi polisi
  // start-nya sendiri sudah di luar jalan raya. Sekarang dipindah ke perempatan asli.
  var POLICE_SPAWN = [[40,40],[-80,-80],[80,-80],[-80,80],[0,-80]];
  POLICE_SPAWN.forEach(function(p){
    var mesh = makePolice();
    mesh.position.set(p[0],0,p[1]);
    scene.add(mesh);
    policeCars.push({
      mesh: mesh, target: randomWaypoint(p[0], p[1]), speed: 6.5,
      chasing:false, chaseUntil:0, cooldownUntil:0, lampBlinkT:0
    });
  });
  var wantedLevel = 0;
  var wantedWrap = document.getElementById('wantedWrap');
  var wantedText = document.getElementById('wantedText');
  function setWanted(n){
    wantedLevel = Math.max(0, Math.min(3, n));
    if (wantedLevel <= 0){
      wantedWrap.style.display = 'none';
    } else {
      wantedWrap.style.display = 'block';
      wantedText.textContent = '⭐'.repeat(wantedLevel);
    }
  }
  var lastViolationToastAt = 0;
  function reportViolation(pos){
    if (state !== 'driving' || !currentVehicle) return;
    var now = performanceNow();
    var caughtAttention = false;
    policeCars.forEach(function(pc){
      if (pc.chasing) return;
      if (now < pc.cooldownUntil) return;
      var dx = pc.mesh.position.x - pos.x, dz = pc.mesh.position.z - pos.z;
      var d = Math.sqrt(dx*dx+dz*dz);
      if (d < 22){
        pc.chasing = true;
        pc.chaseUntil = now + 30;
        caughtAttention = true;
      }
    });
    if (caughtAttention){
      setWanted(wantedLevel + 1);
      startSiren();
      if (now - lastViolationToastAt > 2){
        lastViolationToastAt = now;
        showToast('🚨 Polisi melihat pelanggaranmu!');
      }
    }
  }

  function updatePoliceCars(dt){
    var now = performanceNow();
    var anyChasing = false;
    var nearestChase = 999;
    var targetMesh = (state === 'driving' && currentVehicle) ? currentVehicle.mesh : player;
    policeCars.forEach(function(pc){
      var mesh = pc.mesh;
      pc.lampBlinkT += dt;
      var blinkOn = Math.floor(pc.lampBlinkT*6)%2===0;
      if (pc.chasing){
        anyChasing = true;
        var dx = targetMesh.position.x - mesh.position.x, dz = targetMesh.position.z - mesh.position.z;
        var d = Math.sqrt(dx*dx+dz*dz);
        if (d > 0.5){
          mesh.position.x += (dx/d) * pc.speed * 1.5 * dt;
          mesh.position.z += (dz/d) * pc.speed * 1.5 * dt;
          mesh.rotation.y = Math.atan2(dx, dz);
        }
        if (d < nearestChase) nearestChase = d;
        mesh.userData.redLamp.material.color.setHex(blinkOn?0xff2b3a:0x550008);
        mesh.userData.blueLamp.material.color.setHex(blinkOn?0x2b6cff:0x0a1e55);
        if (d < 3.4 && now > pc.cooldownUntil){
          pc.chasing = false;
          pc.cooldownUntil = now + 6;
          pc.target = randomWaypoint(mesh.position.x, mesh.position.z);
          var fine = 150 + level*20;
          earnMoney(-Math.min(fine, money));
          setWanted(wantedLevel - 1);
          showToast('🚔 Ditilang! -'+moneyFmt(fine));
        } else if (state !== 'driving' || d > 55 || now > pc.chaseUntil){
          pc.chasing = false;
          pc.target = randomWaypoint(mesh.position.x, mesh.position.z);
          setWanted(wantedLevel - 1);
        }
      } else {
        mesh.userData.redLamp.material.color.setHex(0x550008);
        mesh.userData.blueLamp.material.color.setHex(0x0a1e55);
        var pdx = pc.target.x - mesh.position.x, pdz = pc.target.z - mesh.position.z;
        var pd = Math.sqrt(pdx*pdx+pdz*pdz);
        if (pd < 1.5){
          pc.target = randomWaypoint(mesh.position.x, mesh.position.z);
        } else {
          mesh.position.x += (pdx/pd) * pc.speed * dt;
          mesh.position.z += (pdz/pd) * pc.speed * dt;
          mesh.rotation.y = Math.atan2(pdx, pdz);
        }
      }
    });
    if (!anyChasing) stopSiren(); else setSirenLevel(nearestChase);
  }
  var state = "walking";
  var currentVehicle = null;
  var modeLabel = document.getElementById('modeLabel');
  var promptBanner = document.getElementById('promptBanner');
  var promptAction = document.getElementById('promptAction');
  var healthWrap = document.getElementById('healthWrap');
  var healthBar = document.getElementById('healthBar');

  function nearestVehicle(){
    var best = null, bestDist = Infinity;
    vehicles.forEach(function(v){
      if (v.occupied) return;
      var dx = v.mesh.position.x - player.position.x;
      var dz = v.mesh.position.z - player.position.z;
      var d = Math.sqrt(dx*dx+dz*dz);
      if (d < bestDist){ bestDist = d; best = v; }
    });
    return { vehicle: best, dist: bestDist };
  }

  function flashDamage(v){
    var mesh = v.mesh.userData.bodyMesh;
    if (!mesh) return;
    mesh.material.color.setHex(0xff3333);
    setTimeout(function(){
      var tint = 1 - Math.min(0.6, (100-v.health)/160);
      var base = new THREE.Color(v.mesh.userData.baseColor);
      mesh.material.color.copy(base).multiplyScalar(tint + 0.4);
    }, 140);
  }

  function enterVehicle(v){
    if (!unlocked[v.def.name]){
      showToast('🔒 Buka '+v.def.name+' di Garasi dulu!');
      return;
    }
    state = "driving";
    currentVehicle = v;
    v.occupied = true;
    playDoor();
    v.mesh.userData.speed = v.def.speed;
    v.mesh.userData.turnSpeed = v.def.turnSpeed;
    v.mesh.userData.accel = v.def.accel;
    v.mesh.userData.decel = v.def.decel;
    v.mesh.userData.curSpeed = 0;
    v.mesh.userData.altitude = 0;
    player.visible = false;
    modeLabel.textContent = "Nyetir: " + v.def.name;
    healthWrap.style.display = 'block';
    updateHealthBar();
    startEngineSound(v.def.name);
  }

  function updateHealthBar(){
    if (!currentVehicle) return;
    healthBar.style.width = currentVehicle.health + '%';
    healthBar.style.background = currentVehicle.health > 50 ? '#4ade80' : (currentVehicle.health > 20 ? '#e0c341' : '#ff5d3b');
  }

  function exitVehicle(){
    if (!currentVehicle) return;
    currentVehicle.occupied = false;
    playDoor();
    var v = currentVehicle;
    var side = new THREE.Vector3(2.2,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), v.mesh.rotation.y);
    player.position.copy(v.mesh.position).add(side);
    player.position.y = 0;
    player.rotation.y = v.mesh.rotation.y;
    player.visible = true;
    state = "walking";
    currentVehicle = null;
    modeLabel.textContent = "Jalan kaki";
    healthWrap.style.display = 'none';
    stopEngineSound();
  }

  function tryToggleEnter(){
    if (qzState.open || garageOpen || bkOpen) return;
    ensureAudio();
    if (state === "walking"){
      var res = nearestVehicle();
      if (res.vehicle && res.dist < res.vehicle.def.enterDist + 1.2){
        enterVehicle(res.vehicle);
      }
    } else {
      if (currentVehicle && currentVehicle.mesh.position.y > 2) return; // can't exit mid-air
      exitVehicle();
    }
  }

  document.getElementById('enterBtn').addEventListener('click', tryToggleEnter);
  document.getElementById('enterBtn').addEventListener('touchstart', function(e){ e.preventDefault(); tryToggleEnter(); }, {passive:false});

  document.getElementById('honkBtn').addEventListener('click', function(){ ensureAudio(); playHonk(); });
  document.getElementById('honkBtn').addEventListener('touchstart', function(e){ e.preventDefault(); ensureAudio(); playHonk(); }, {passive:false});

  // ================= input =================
  var keys = {};
  window.addEventListener('keydown', function(e){
    keys[e.key.toLowerCase()] = true;
    ensureAudio();
    if (e.key.toLowerCase() === 'e') tryToggleEnter();
    if (e.key.toLowerCase() === 'h') playHonk();
  });
  window.addEventListener('keyup', function(e){ keys[e.key.toLowerCase()] = false; });

  var stickZone = document.getElementById('stickZone');
  var stickNub = document.getElementById('stickNub');
  var joy = { active:false, x:0, y:0 };
  function stickReset(){ joy.x=0; joy.y=0; stickNub.style.transform='translate(0px,0px)'; }
  function handleStick(clientX, clientY){
    var rect = stickZone.getBoundingClientRect();
    var cx = rect.left + rect.width/2;
    var cy = rect.top + rect.height/2;
    var dx = clientX - cx, dy = clientY - cy;
    var max = rect.width/2;
    var dist = Math.min(Math.sqrt(dx*dx+dy*dy), max);
    var ang = Math.atan2(dy,dx);
    var nx = Math.cos(ang)*dist, ny = Math.sin(ang)*dist;
    stickNub.style.transform = 'translate(' + nx + 'px,' + ny + 'px)';
    joy.x = nx/max; joy.y = ny/max;
  }
  // PERBAIKAN: pakai identifier sentuhan, jadi menekan tombol lain sambil menahan joystick tidak mengacaukan arah
  var stickTouchId = null;
  function endStickTouch(e){
    e.preventDefault();
    for (var i=0;i<e.changedTouches.length;i++){
      if (e.changedTouches[i].identifier === stickTouchId){ joy.active = false; stickTouchId = null; stickReset(); }
    }
  }
  stickZone.addEventListener('touchstart', function(e){
    e.preventDefault(); ensureAudio();
    var t = e.changedTouches[0];
    stickTouchId = t.identifier; joy.active = true;
    handleStick(t.clientX, t.clientY);
  }, {passive:false});
  stickZone.addEventListener('touchmove', function(e){
    e.preventDefault();
    for (var i=0;i<e.changedTouches.length;i++){
      var t = e.changedTouches[i];
      if (t.identifier === stickTouchId) handleStick(t.clientX, t.clientY);
    }
  }, {passive:false});
  stickZone.addEventListener('touchend', endStickTouch, {passive:false});
  stickZone.addEventListener('touchcancel', endStickTouch, {passive:false});

  // ---- tombol LARI (jalan kaki) / TURBO (kendaraan): tahan untuk ngebut, dibatasi stamina ----
  var sprintHeld = false, sprinting = false, boosting = false, sprintLocked = false, stamina = 100;
  var sprintBtn = document.getElementById('sprintBtn');
  function setSprint(v){ sprintHeld = v; sprintBtn.classList.toggle('on', v); }
  sprintBtn.addEventListener('touchstart', function(e){ e.preventDefault(); ensureAudio(); setSprint(true); }, {passive:false});
  sprintBtn.addEventListener('touchend', function(e){ e.preventDefault(); setSprint(false); }, {passive:false});
  sprintBtn.addEventListener('touchcancel', function(e){ e.preventDefault(); setSprint(false); }, {passive:false});
  sprintBtn.addEventListener('mousedown', function(){ ensureAudio(); setSprint(true); });
  window.addEventListener('mouseup', function(){ setSprint(false); });
  stickZone.addEventListener('mousedown', function(e){ ensureAudio(); joy.active=true; handleStick(e.clientX, e.clientY); });
  window.addEventListener('mousemove', function(e){ if(joy.active) handleStick(e.clientX, e.clientY); });
  window.addEventListener('mouseup', function(){ joy.active=false; stickReset(); });

  // ================= sound (Web Audio, procedural) =================
  var actx = null;
  var engineOsc = null, engineGain = null;
  function ensureAudio(){
    if (!actx){
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        startAmbient();
      } catch(e){ actx = null; audioErr(e); }
    }
    // iOS/Safari sering membuat AudioContext dalam keadaan 'suspended'
    if (actx && actx.state === 'suspended'){ try { actx.resume(); } catch(e){} }
  }
  function audioErr(e){ if(!audioErr.n){ audioErr.n = 1; console.warn('audio:', e); } }
  var footstepAcc = 0;
  var speedingAcc = 0;

  // ---- dasar: master + kompresor (biar tidak pecah), buffer noise, helper suara ----
  var master = null, noiseBuf = null;
  function out(){
    if (!master){
      master = actx.createGain(); master.gain.value = 0.9;
      var comp = actx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      master.connect(comp); comp.connect(actx.destination);
    }
    return master;
  }
  function getNoise(){
    if (!noiseBuf){
      var len = actx.sampleRate * 2;
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i=0;i<len;i++) d[i] = Math.random()*2 - 1;
    }
    return noiseBuf;
  }
  function noiseSrc(loop){ var s = actx.createBufferSource(); s.buffer = getNoise(); s.loop = !!loop; return s; }
  // letupan noise lewat filter: dasar suara langkah, benturan, pintu
  function burst(type, freq, q, vol, dur, when){
    var t0 = when || actx.currentTime;
    var s = noiseSrc(false), f = actx.createBiquadFilter(), g = actx.createGain();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(out());
    s.start(t0, Math.random()*1.5); s.stop(t0 + dur + 0.02);
  }
  function tone(type, f0, f1, vol, dur, when){
    var t0 = when || actx.currentTime;
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out()); o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // ---- klakson: dua nada sawtooth (seperti klakson asli), beda tiap kendaraan ----
  var HORNS = { 'Sedan':[392,494], 'Sport Car':[440,554], 'Motor':[660,830], 'Truk':[190,240], 'Pesawat':[300,375], 'Perahu':[150,190] };
  function playHonk(){
    if (!actx) return;
    try {
      var name = (state === 'driving' && currentVehicle) ? currentVehicle.def.name : 'Sedan';
      var fr = HORNS[name] || HORNS.Sedan;
      var t0 = actx.currentTime, dur = (name === 'Truk' || name === 'Perahu') ? 0.75 : 0.4;
      var g = actx.createGain(), f = actx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 2200;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.15, t0 + 0.025);
      g.gain.setValueAtTime(0.15, t0 + dur - 0.06);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      fr.forEach(function(hz){
        var o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz;
        o.connect(f); o.start(t0); o.stop(t0 + dur + 0.02);
      });
      f.connect(g); g.connect(out());
    } catch(e){ audioErr(e); }
  }
  // ---- klakson NPC: nada generik, lebih pelan dari klakson pemain, dipicu saat mobil NPC harus ngerem mendadak karena kita ----
  function playNpcHonk(){
    if (!actx) return;
    try {
      var t0 = actx.currentTime, dur = 0.35;
      var g = actx.createGain(), f = actx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1800;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.07, t0 + 0.02);
      g.gain.setValueAtTime(0.07, t0 + dur - 0.05);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      [420, 528].forEach(function(hz){
        var o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz;
        o.connect(f); o.start(t0); o.stop(t0 + dur + 0.02);
      });
      f.connect(g); g.connect(out());
    } catch(e){ audioErr(e); }
  }
  // ---- tabrakan: benturan berat + kerincing logam ----
  function playThud(){
    if (!actx) return;
    try { burst('lowpass', 380, 0.7, 0.5, 0.28); burst('bandpass', 1800, 1.2, 0.22, 0.12); tone('sine', 130, 38, 0.45, 0.3); }
    catch(e){ audioErr(e); }
  }
  // ---- sirene polisi: gelombang sawtooth disapu LFO, volume mengikuti jarak ----
  var sirenNodes = null;
  function startSiren(){
    if (!actx || sirenNodes) return;
    try {
      var o = actx.createOscillator(), lfo = actx.createOscillator(), lg = actx.createGain();
      var f = actx.createBiquadFilter(), g = actx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 850;
      lfo.type = 'sine'; lfo.frequency.value = 0.85; lg.gain.value = 290;
      lfo.connect(lg); lg.connect(o.frequency);
      f.type = 'lowpass'; f.frequency.value = 2400;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.linearRampToValueAtTime(0.06, actx.currentTime + 0.3);
      o.connect(f); f.connect(g); g.connect(out());
      o.start(); lfo.start();
      sirenNodes = { o:o, lfo:lfo, g:g };
    } catch(e){ audioErr(e); }
  }
  function setSirenLevel(d){
    if (!sirenNodes || !actx) return;
    var lv = Math.max(0.008, Math.min(0.1, 0.1 * (1 - Math.min(d, 70)/75)));
    sirenNodes.g.gain.setTargetAtTime(lv, actx.currentTime, 0.15);
  }
  function stopSiren(){
    if (!sirenNodes || !actx) return;
    var s = sirenNodes; sirenNodes = null;
    try {
      s.g.gain.cancelScheduledValues(actx.currentTime);
      s.g.gain.setTargetAtTime(0.0001, actx.currentTime, 0.1);
      setTimeout(function(){ try { s.o.stop(); s.lfo.stop(); } catch(e){} }, 500);
    } catch(e){ audioErr(e); }
  }
  // ---- efek kecil ----
  function playCoin(){
    if (!actx) return;
    try { var t = actx.currentTime; tone('triangle', 988, null, 0.09, 0.22, t); tone('triangle', 1319, null, 0.09, 0.3, t + 0.07); tone('sine', 2637, null, 0.03, 0.25, t + 0.07); }
    catch(e){ audioErr(e); }
  }
  function playCorrect(){
    if (!actx) return;
    try { var t = actx.currentTime; [523,659,784,1047].forEach(function(hz, i){ tone('triangle', hz, null, 0.1, 0.4, t + i*0.07); tone('sine', hz*2, null, 0.03, 0.3, t + i*0.07); }); }
    catch(e){ audioErr(e); }
  }
  function playWrong(){
    if (!actx) return;
    try { var t = actx.currentTime; tone('sawtooth', 196, 120, 0.1, 0.4, t); tone('sawtooth', 185, 110, 0.08, 0.4, t + 0.02); }
    catch(e){ audioErr(e); }
  }
  function playLevelUp(){
    if (!actx) return;
    try { var t = actx.currentTime; [392,494,587,784,988].forEach(function(hz, i){ tone('triangle', hz, null, 0.11, 0.35, t + i*0.09); tone('square', hz, null, 0.025, 0.2, t + i*0.09); }); }
    catch(e){ audioErr(e); }
  }
  function playCash(){
    if (!actx) return;
    try { var t = actx.currentTime; burst('highpass', 6000, 1, 0.08, 0.05, t); tone('sine', 1568, null, 0.1, 0.3, t + 0.04); tone('sine', 2093, null, 0.09, 0.4, t + 0.11); }
    catch(e){ audioErr(e); }
  }
  function playDoor(){
    if (!actx) return;
    try { var t = actx.currentTime; burst('lowpass', 700, 1, 0.3, 0.12, t); tone('sine', 150, 70, 0.25, 0.14, t); burst('highpass', 3000, 2, 0.08, 0.06, t + 0.1); }
    catch(e){ audioErr(e); }
  }
  // ---- langkah kaki: letupan noise, di aspal lebih nyaring dari di rumput; lari lebih tegas ----
  function playFootstep(run){
    if (!actx) return;
    try {
      var onRoad = nearRoad(player.position.x) || nearRoad(player.position.z);
      var f = (onRoad ? 1400 : 500) * (0.85 + Math.random()*0.3) * (run ? 1.15 : 1);
      burst('bandpass', f, 1.1, run ? 0.16 : 0.11, 0.07);
      tone('sine', run ? 110 : 90, 55, run ? 0.09 : 0.06, 0.08);
    } catch(e){ audioErr(e); }
  }

  // ---- ambien kota + jangkrik di malam hari ----
  var amb = null;
  function startAmbient(){
    if (!actx || amb) return;
    try {
      var s = noiseSrc(true), f = actx.createBiquadFilter(), g = actx.createGain();
      f.type = 'lowpass'; f.frequency.value = 380; g.gain.value = 0.02;
      s.connect(f); f.connect(g); g.connect(out()); s.start();
      var c = actx.createOscillator(), cg = actx.createGain(), lfo = actx.createOscillator(), lg = actx.createGain(), ng = actx.createGain();
      c.type = 'sine'; c.frequency.value = 4300;
      lfo.type = 'square'; lfo.frequency.value = 14; lg.gain.value = 0.5; cg.gain.value = 0;
      lfo.connect(lg); lg.connect(cg.gain);
      ng.gain.value = 0;
      c.connect(cg); cg.connect(ng); ng.connect(out());
      c.start(); lfo.start();
      amb = { ng: ng };
    } catch(e){ audioErr(e); }
  }
  function setAmbientNight(n){
    if (!amb || !actx) return;
    amb.ng.gain.setTargetAtTime(n > 0.55 ? 0.02 : 0, actx.currentTime, 0.8);
  }

  // ---- mesin: 2 osilator + sub, filter lowpass mengikuti RPM, simulasi perpindahan gigi, angin/jalan, decit ban, turbo ----
  var eng = null;
  function startEngineSound(vehicleName){
    if (!actx) return;
    try {
      stopEngineSound();
      var def = VEHICLE_DEFS.filter(function(d){ return d.name === vehicleName; })[0];
      var snd = (def && def.sound) || {wave:'sawtooth', base:55, range:150, sub:true};
      var now = actx.currentTime;
      var domain = def ? def.domain : 'land';
      var f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 1.2;
      var g = actx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.08, now + 0.4);
      var o1 = actx.createOscillator(); o1.type = snd.wave; o1.frequency.value = snd.base;
      var o2 = actx.createOscillator(); o2.type = 'square'; o2.frequency.value = snd.base * 1.005;
      var g2 = actx.createGain(); g2.gain.value = 0.35;
      var sub = actx.createOscillator(); sub.type = 'sine'; sub.frequency.value = snd.base * 0.5;
      var gs = actx.createGain(); gs.gain.value = snd.sub ? 0.7 : 0.2;
      o1.connect(f); o2.connect(g2); g2.connect(f); sub.connect(gs); gs.connect(f);
      // getaran idle (mesin "berdetak")
      var lope = actx.createOscillator(), lg = actx.createGain();
      lope.frequency.value = domain === 'land' ? 9 : 5; lg.gain.value = 0.012;
      lope.connect(lg); lg.connect(g.gain);
      f.connect(g); g.connect(out());
      // angin / jalan
      var ns = noiseSrc(true), nf = actx.createBiquadFilter(), ng = actx.createGain();
      nf.type = 'bandpass'; nf.frequency.value = 600; nf.Q.value = 0.7; ng.gain.value = 0;
      ns.connect(nf); nf.connect(ng); ng.connect(out());
      // decit ban
      var ss = noiseSrc(true), sf = actx.createBiquadFilter(), sg = actx.createGain();
      sf.type = 'bandpass'; sf.frequency.value = 2600; sf.Q.value = 5; sg.gain.value = 0;
      ss.connect(sf); sf.connect(sg); sg.connect(out());
      [o1, o2, sub, lope].forEach(function(o){ o.start(now); });
      ns.start(); ss.start();
      eng = { snd:snd, domain:domain, name:vehicleName, o1:o1, o2:o2, sub:sub, lope:lope, f:f, g:g, ns:ns, nf:nf, ng:ng, ss:ss, sg:sg,
              geared: (domain === 'land'), gears: vehicleName === 'Truk' ? 4 : 5, gear:0, shiftUntil:0, lastA:0 };
      // suara starter
      burst('lowpass', 220, 1, 0.22, 0.3, now); tone('sawtooth', 40, 70, 0.08, 0.35, now);
    } catch(e){ audioErr(e); }
  }
  function updateEngineSound(speedFrac, turn){
    if (!eng || !actx) return;
    try {
      var t = actx.currentTime, a = Math.abs(speedFrac), tc = 0.06;
      var rpm;
      if (eng.geared){
        var gr = Math.min(eng.gears - 1, Math.floor(Math.min(a, 1) * eng.gears));
        var within = Math.min(a, 1) * eng.gears - gr;
        rpm = 0.16 + Math.max(0, Math.min(1, within)) * 0.78;
        if (gr !== eng.gear){ if (gr > eng.gear) eng.shiftUntil = t + 0.16; eng.gear = gr; }
      } else {
        rpm = 0.2 + Math.min(a, 1.4) * 0.75;
      }
      var load = a > eng.lastA + 0.0004 ? 1 : 0;
      eng.lastA = a;
      var boost = boosting ? 1.12 : 1;
      var f0 = (eng.snd.base + rpm * eng.snd.range) * boost;
      eng.o1.frequency.setTargetAtTime(f0, t, tc);
      eng.o2.frequency.setTargetAtTime(f0 * 1.005, t, tc);
      eng.sub.frequency.setTargetAtTime(f0 * 0.5, t, tc);
      eng.f.frequency.setTargetAtTime(350 + rpm * 1800 + load * 400 + (boosting ? 500 : 0), t, tc);
      var shifting = t < eng.shiftUntil;
      eng.g.gain.setTargetAtTime(shifting ? 0.03 : 0.05 + Math.min(a, 1.3) * 0.04 + load * 0.02, t, 0.05);
      var land = eng.domain === 'land';
      eng.ng.gain.setTargetAtTime((land ? a * 0.05 : a * 0.09) + (boosting ? 0.05 : 0), t, 0.1);
      eng.nf.frequency.setTargetAtTime(400 + a * 1500, t, 0.1);
      eng.sg.gain.setTargetAtTime((land && Math.abs(turn || 0) > 0.6 && a > 0.55) ? 0.05 * a : 0, t, 0.05);
    } catch(e){ audioErr(e); }
  }
  function stopEngineSound(){
    if (!eng || !actx) { eng = null; return; }
    var e = eng; eng = null;
    try {
      var t = actx.currentTime;
      e.g.gain.cancelScheduledValues(t); e.g.gain.setTargetAtTime(0.0001, t, 0.08);
      e.ng.gain.setTargetAtTime(0.0001, t, 0.08); e.sg.gain.setTargetAtTime(0.0001, t, 0.05);
      setTimeout(function(){ [e.o1, e.o2, e.sub, e.lope, e.ns, e.ss].forEach(function(n){ try { n.stop(); } catch(x){} }); }, 500);
    } catch(x){ audioErr(x); }
  }



  // Lampu lalu lintas beneran: merah -> hijau -> kuning -> merah, tiap lampu punya fase sendiri
  var TRAFFIC_LIGHTS = [];
  var LIGHT_CYCLE = { red: 6, green: 6, yellow: 1.5 };
  var LIGHT_ON = { red: 0xff4455, yellow: 0xffd34d, green: 0x55e59a };
  var LIGHT_OFF = { red: 0x330a0d, yellow: 0x332a0a, green: 0x0a2418 };
  function updateLightVisual(tl){
    tl.redMat.color.setHex(tl.state === 'red' ? LIGHT_ON.red : LIGHT_OFF.red);
    tl.yellowMat.color.setHex(tl.state === 'yellow' ? LIGHT_ON.yellow : LIGHT_OFF.yellow);
    tl.greenMat.color.setHex(tl.state === 'green' ? LIGHT_ON.green : LIGHT_OFF.green);
  }
  function addTrafficLight(x,z,phaseOffset){
    var pole=addBox(x,z,0.12,3.2,0.12,0x303640);
    var box=addBox(x,z-0.08,0.35,0.9,0.25,0x11151b);
    box.position.y=2.6;
    var mats = [0xff4455,0xffd34d,0x55e59a].map(function(col,i){
      var mat = new THREE.MeshBasicMaterial({color:col});
      var lamp=new THREE.Mesh(new THREE.SphereGeometry(.07,8,8), mat);
      lamp.position.set(x,2.35+i*.25,z-0.23);
      scene.add(lamp);
      return mat;
    });
    var tl = { x:x, z:z, state:'red', timer: LIGHT_CYCLE.red - (phaseOffset||0), redMat:mats[0], yellowMat:mats[1], greenMat:mats[2] };
    TRAFFIC_LIGHTS.push(tl);
    updateLightVisual(tl);
    return tl;
  }
  function updateTrafficLights(dt){
    TRAFFIC_LIGHTS.forEach(function(tl){
      tl.timer -= dt;
      if (tl.timer <= 0){
        if (tl.state === 'red'){ tl.state = 'green'; tl.timer = LIGHT_CYCLE.green; }
        else if (tl.state === 'green'){ tl.state = 'yellow'; tl.timer = LIGHT_CYCLE.yellow; }
        else { tl.state = 'red'; tl.timer = LIGHT_CYCLE.red; }
        updateLightVisual(tl);
      }
    });
  }
  addTrafficLight(4,4,0); addTrafficLight(-44,4,4); addTrafficLight(44,4,9);

  // ================= JALAN-JALAN CITY 2.0 SYSTEMS (moved up: needed before placeMission runs) =================
  var money = 0, xp = 0, level = 1;
  var missionDeadline = 0, missionStartedAt = 0;
  var fuel = 100;
  var missionReward = 150;
  var speedValue = document.getElementById('speedValue');
  var fuelBar = document.getElementById('fuelBar');
  var moneyText = document.getElementById('moneyText');
  var levelText = document.getElementById('levelText');
  var xpBar = document.getElementById('xpBar');
  var mission2 = document.getElementById('mission2');
  var missionTimer = document.getElementById('missionTimer');
  var unlocked = {Sedan:true, 'Motor':true};

  function moneyFmt(n){
    return 'Rp ' + Math.floor(n).toLocaleString('id-ID');
  }
  function xpNeed(){
    return 100 + (level-1)*60;
  }
  function addXP(n){
    xp += n;
    while(xp >= xpNeed()){
      xp -= xpNeed();
      level++;
      showLevelUp();
    }
    levelText.textContent = level;
    xpBar.style.width = Math.min(100, xp/xpNeed()*100) + '%';
  }
  function showLevelUp(){
    playLevelUp();
    var el = document.getElementById('levelToast');
    el.textContent = 'LEVEL ' + level + '!';
    el.style.display = 'block';
    clearTimeout(showLevelUp._t);
    showLevelUp._t = setTimeout(function(){el.style.display='none'},1600);
  }
  function earnMoney(n){
    money += n;
    moneyText.textContent = moneyFmt(money);
  }
  function setFuel(n){
    fuel = Math.max(0,Math.min(100,n));
    fuelBar.style.width = fuel + '%';
    fuelBar.style.background = fuel > 35 ? '#55e59a' : (fuel > 15 ? '#ffd34d' : '#ff6578');
  }

  // ================= missions =================
  var score = 0;
  var missionState = 'pickup'; // 'pickup' or 'dropoff'
  var scoreText = document.getElementById('scoreText');
  var toast = document.getElementById('toast');
  function showToast(msg){
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function(){ toast.style.display = 'none'; }, 1800);
  }

  var beaconGeo = new THREE.CylinderGeometry(0.05, 0.6, 14, 12, 1, true);
  var pickupMat = new THREE.MeshBasicMaterial({ color:0xf2d233, transparent:true, opacity:0.35, side:THREE.DoubleSide });
  var dropoffMat = new THREE.MeshBasicMaterial({ color:0x4ade80, transparent:true, opacity:0.35, side:THREE.DoubleSide });
  var beacon = new THREE.Mesh(beaconGeo, pickupMat);
  scene.add(beacon);
  var beaconRing = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.1, 8, 20), new THREE.MeshBasicMaterial({color:0xf2d233}));
  beaconRing.rotation.x = Math.PI/2;
  scene.add(beaconRing);
  var missionPos = new THREE.Vector3();

  // taxi missions sometimes require a specific vehicle to complete the drop-off
  var LAND_VEHICLE_NAMES = VEHICLE_DEFS.filter(function(d){ return d.domain === 'land'; }).map(function(d){ return d.name; });
  var requiredVehicle = null;

  function placeMission(kind){
    var spot = randOpenSpot();
    missionPos.set(spot.x, 0, spot.z);
    beacon.position.set(spot.x, 7, spot.z);
    beaconRing.position.set(spot.x, 0.15, spot.z);
    if (kind === 'pickup'){
      requiredVehicle = Math.random() < 0.45 ? LAND_VEHICLE_NAMES[Math.floor(Math.random()*LAND_VEHICLE_NAMES.length)] : null;
      beacon.material = pickupMat;
      beaconRing.material.color.setHex(0xf2d233);
    } else {
      beacon.material = dropoffMat;
      beaconRing.material.color.setHex(0x4ade80);
    }
    mission2.textContent = kind === 'pickup'
      ? (requiredVehicle ? 'Jemput • '+requiredVehicle : 'Jemput penumpang')
      : 'Antar penumpang ke tujuan';
    missionStartedAt = performanceNow();
    missionDeadline = missionStartedAt + 45 + Math.min(20, level*2);
  }
  placeMission('pickup');
  moneyText.textContent = moneyFmt(money);
  levelText.textContent = level;
  xpBar.style.width = '0%';
  setFuel(100);
  loadGame();

  // ================= koin XP tersebar =================
  var coins = [];
  var coinGeo = new THREE.TorusGeometry(0.45, 0.16, 8, 16);
  var coinMat = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  function spawnCoin(){
    var spot = randOpenSpot();
    var mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.position.set(spot.x, 1.1, spot.z);
    mesh.rotation.x = Math.PI/2;
    scene.add(mesh);
    coins.push({ mesh: mesh, collected:false, respawnAt:0 });
  }
  for (var ci=0; ci<32; ci++) spawnCoin();

  function updateCoins(dt, pos){
    var now = performanceNow();
    coins.forEach(function(c){
      if (c.collected){
        if (now > c.respawnAt){
          var spot = randOpenSpot();
          c.mesh.position.x = spot.x; c.mesh.position.z = spot.z;
          c.mesh.visible = true;
          c.collected = false;
        }
        return;
      }
      c.mesh.rotation.z += dt*2.2;
      c.mesh.position.y = 1.1 + Math.sin(now*2 + c.mesh.position.x) * 0.15;
      var dx = pos.x - c.mesh.position.x, dz = pos.z - c.mesh.position.z;
      if (dx*dx + dz*dz < 2.9){
        c.collected = true;
        c.mesh.visible = false;
        c.respawnAt = now + 25 + Math.random()*20;
        earnMoney(15);
        addXP(6);
        playCoin();
      }
    });
  }

  function checkMission(pos){
    var d = Math.sqrt(Math.pow(pos.x-missionPos.x,2) + Math.pow(pos.z-missionPos.z,2));
    if (d < 3.5){
      if (missionState === 'pickup'){
        missionState = 'dropoff';
        showToast(requiredVehicle ? ('Penumpang naik! Cari ' + requiredVehicle + ' untuk antar.') : 'Penumpang naik! Antar ke titik hijau.');
        placeMission('dropoff');
      } else {
        if (requiredVehicle && (state !== 'driving' || currentVehicle.def.name !== requiredVehicle)){
          showToast('Penumpang minta naik ' + requiredVehicle + ' dulu!');
          return;
        }
        score += 1;
        scoreText.textContent = score;
        var timeBonus = missionDeadline>0 ? Math.max(0,Math.round((missionDeadline-performanceNow())*4)) : 0;
        var reward = missionReward + timeBonus + level*25;
        earnMoney(reward);
        addXP(35);
        showToast('Terkirim! +'+moneyFmt(reward)+' • +35 XP');
        playCash();
        if (state === 'walking' && playerActor) actorOnce(playerActor, 'ThumbsUp');
        missionState = 'pickup';
        missionDeadline = 0;
        placeMission('pickup');
      }
    }
  }

  // ================= landmark exploration =================
  // NgodeTrip 3D fusion: setiap landmark kini jadi "Kristal Coding"
  // yang memicu satu soal belajar JavaScript saat didekati.
  const LEVELS = [
  {
    title: 'Gerbang Desa Kode', short: 'Variabel, console.log, tipe data & sintaks dasar',
    coords: [-5, -3],
    story: 'Pesawatmu mendarat di gerbang <b>"DESA KODE"</b>. Robot penjaga <b>Pak Byte</b> menyapa: <i>"Buktikan kamu menguasai fondasi: variabel si kotak penyimpan, console.log corong suara, dan tanda baca sakti JavaScript!"</i>',
    epilogue: 'Pak Byte tersenyum lebar! Portal kayu digital terbuka, menampakkan jalan setapak menuju Hutan Operator.',
    qs: [
      { type:'fill', learnTitle:'Apa itu Variabel?', learn:'Bayangkan <b>variabel</b> seperti kotak berlabel untuk menyimpan data di memori komputer. <code>let umur = 25;</code> artinya kotak "umur" diisi angka 25.',
        code:'___ umur = 25;\nconsole.log(umur);', q:'Kode ini belum bisa jalan: ada kata kunci yang hilang di awal baris pertama. Ketik kata kunci untuk membuat variabel baru.',
        ans:[['let','const','var']], run:'25', hint:'Kata kunci 3 huruf yang dipakai di contoh materi di atas.',
        exp:'"let" adalah kata kunci untuk membuat variabel baru di JavaScript modern (const dan var juga bisa, dengan aturan berbeda).' },
      { type:'predict', learnTitle:'console.log itu Apa?', learn:'<code>console.log()</code> ibarat corong suara — ia menampilkan hasil atau teks ke layar konsol agar kita bisa membacanya.',
        code:'let sapaan = "Halo Dunia 3D!";\nconsole.log(sapaan);', q:'Kalau kode ini dijalankan, teks apa yang muncul di console? Ketik persis hasilnya.',
        ans:['Halo Dunia 3D!'], hint:'console.log mencetak isi variabel sapaan.', exp:'console.log() mencetak nilai apapun di dalam kurungnya ke layar konsol — di sini isi variabel sapaan.' },
      { type:'tapline', learnTitle:'Angka vs Teks (String)', learn:'Teks (String) selalu diapit tanda kutip (<code>"teks"</code>). Angka ditulis polos tanpa tanda kutip agar dapat dihitung.',
        code:'let a = 100;\nlet b = "100";\nlet c = 3.14;\nlet d = true;', q:'Ketuk baris yang membuat variabel bertipe teks (string), lalu tekan Jalankan.',
        ans:1, hint:'Cari nilai yang diapit tanda kutip.', exp:'b diapit tanda kutip ("100") sehingga dianggap teks oleh komputer, walaupun isinya angka.' },
      { type:'fill', learnTitle:'Kurung Kurawal { } (Blok Kode)', learn:'Tanda <code>{ }</code> adalah pembungkus blok program. Perintah di dalamnya dieksekusi bersamaan saat kondisi (seperti <code>if</code>) terpenuhi.',
        code:'let baterai = 15;\nif (baterai < 20) ___\n  console.log("Mode hemat energi!");\n___', q:'Lengkapi pembungkus blok if: ketik tanda pembuka di kotak pertama dan penutup di kotak kedua.',
        ans:[['{'],['}']], run:'Mode hemat energi!', hint:'Pembuka dan penutup blok adalah sepasang kurung kurawal.', exp:'{ } mengelompokkan satu atau beberapa baris perintah menjadi satu blok yang dijalankan bersama saat kondisi if terpenuhi.' },
      { type:'order', learnTitle:'Titik Koma ( ; ) & Urutan Kode', learn:'Tanda <code>;</code> di akhir baris menandakan satu instruksi selesai, mirip titik pada akhir kalimat. Komputer membaca kode dari <b>atas ke bawah</b>, jadi urutan itu penting!',
        lines:['let harga = 5000;','let total = harga * 3;','console.log(total);'], q:'Susun baris-baris ini supaya program mencetak 15000. Ketuk baris pilihan secara berurutan.',
        run:'15000', hint:'Variabel harus dibuat sebelum dipakai. Cetak hasilnya paling akhir.', exp:'harga dibuat dulu, lalu dipakai untuk menghitung total, terakhir total dicetak. Kalau urutannya terbalik, komputer belum tahu isi variabelnya.' }
    ]
  },
  {
    title: 'Hutan Operator & Looping', short: 'Modulo %, template literals, array push & for loop',
    coords: [-2.5, 1.2],
    story: 'Kamu memasuki <b>HUTAN OPERATOR</b> yang bercahaya biru. Roh pohon <b>Nyai Sintaks</b> mengawasi: <i>"Jangan sampai tertukar antara modulo % dan persen biasa!"</i>',
    epilogue: 'Dedaunan kristal berdenting merdu. Nyai Sintaks mengizinkanmu melintasi hutan menuju Lorong Bug.',
    qs: [
      { type:'predict', learnTitle:'Operator % (Modulo)', learn:'Simbol <code>%</code> adalah <b>Modulo (sisa bagi)</b>. Contoh: <code>7 % 3</code> hasilnya <b>1</b>, karena 7 dibagi 3 = 2 dengan sisa 1.',
        code:'let apel = 10;\nlet orang = 3;\nconsole.log(apel % orang);', q:'Berapa angka yang tercetak di console?',
        ans:['1'], hint:'10 dibagi 3 = 3 dengan sisa berapa?', exp:'10 dibagi 3 = 3 sisa 1. Modulo mengembalikan sisa pembagian bulat, yaitu 1.' },
      { type:'predict', learnTitle:'Template Literals', learn:'String backtick <code>`...`</code> mempermudah menyisipkan variabel langsung dengan format <code>${nama}</code>.',
        code:'let pemain = "Aero";\nconsole.log(`Halo, ${pemain}!`);', q:'Teks apa yang tercetak? Ketik persis hasilnya.',
        ans:['Halo, Aero!'], hint:'${pemain} diganti dengan isi variabel pemain.', exp:'Template literal menyisipkan nilai variabel pemain ("Aero") secara otomatis.' },
      { type:'fill', learnTitle:'Array & .push()', learn:'Array adalah daftar data <code>[1, 2]</code>. Method <code>.push(item)</code> menyisipkan item baru ke ujung paling belakang.',
        code:'let tas = ["kunci", "buku"];\ntas.___("koin");\nconsole.log(tas.length);', q:'Ketik nama method yang menambahkan "koin" ke ujung array.',
        ans:[['push']], run:'3', hint:'Nama method-nya ada di teks materi (5 huruf).', exp:'.push() menambah 1 elemen ke ujung array, sehingga panjang tas berubah dari 2 menjadi 3.' },
      { type:'predict', learnTitle:'Perulangan (Loop) for', learn:'Loop <code>for (let i=0; i&lt;n; i++)</code> mengulang perintah sebanyak n kali secara otomatis. Variabel i bertindak sebagai penghitung putaran.',
        code:'let pesan = "";\nfor (let i = 0; i < 3; i++) {\n  pesan += i + " ";\n}\nconsole.log(pesan);', q:'Angka apa saja yang tercetak (urut, pisahkan dengan spasi)?',
        ans:['0 1 2'], hint:'i mulai dari 0 dan berhenti sebelum mencapai 3.', exp:'Loop mulai dari i=0, lalu 1, lalu 2. Saat i mencapai 3, kondisi i<3 sudah false sehingga perulangan berhenti.' }
    ]
  },
  {
    title: 'Lorong Bug & Debugging', short: 'Assignment =, parameter undefined, & indeks array',
    coords: [0, -2.3],
    story: 'Kamu melangkah ke <b>LORONG BUG</b> yang berkedip tak stabil. <b>Cyber Spider</b> menantangmu: <i>"Temukan letak bug sebelum lorong crash!"</i>',
    epilogue: 'Lampu lorong stabil menjadi hijau tenang. Audit selesai tanpa ada error!',
    qs: [
      { type:'tapline', learnTitle:'= vs ===', learn:'<code>=</code> mengisi nilai. Untuk mengecek perbandingan di <code>if</code>, selalu gunakan <code>===</code> atau <code>==</code>.',
        code:'let nyawa = 100;\nif (nyawa = 0) {\n  console.log("Kalah!");\n}', q:'Ada bug di kode ini. Ketuk baris yang bermasalah, lalu tekan Jalankan.',
        ans:1, hint:'Perhatikan tanda sama dengan di dalam kurung if.', exp:'Tanda = justru menimpa isi variabel nyawa menjadi 0 alih-alih membandingkannya. Seharusnya nyawa === 0.' },
      { type:'predict', learnTitle:'Parameter yang Kurang', learn:'Jika fungsi butuh 2 argumen namun dipanggil hanya dengan 1, argumen kedua otomatis <code>undefined</code>. Angka * undefined = <code>NaN</code>.',
        code:'function kali(a, b) {\n  return a * b;\n}\nconsole.log(kali(5));', q:'Apa yang tercetak di console? Ketik hasilnya.',
        ans:['NaN'], hint:'Parameter b tidak diisi. Berapa 5 dikali "tidak ada"?', exp:'Parameter b bernilai undefined. 5 * undefined menghasilkan NaN (Not a Number).' },
      { type:'tapline', learnTitle:'Off-by-One Error pada Indeks Array', learn:'Indeks array selalu mulai dari 0. Array panjang 3 punya indeks 0, 1, 2. Mengakses indeks 3 mengembalikan <code>undefined</code>.',
        code:'let skor = [80, 90, 95];\nfor (let i = 0; i <= skor.length; i++) {\n  console.log(skor[i]);\n}', q:'Loop ini mencetak undefined di putaran terakhir. Ketuk baris yang jadi biang masalahnya.',
        ans:1, hint:'Lihat kondisi loop: apakah i boleh sama dengan skor.length?', exp:'skor.length adalah 3. Penggunaan <= membuat loop berjalan sampai i=3. Karena skor[3] tidak ada, nilainya undefined. Seharusnya i < skor.length.' }
    ]
  },
  {
    title: 'Menara Fungsi & Array', short: 'Deklarasi function, ternary operator, & method .map()',
    coords: [2.8, 1.4],
    story: 'Pencakar langit ungu <b>MENARA FUNGSI</b> menjulang tinggi. <b>Kapten Lambda</b> meminta bantuan melengkapi baris kode kendali lift.',
    epilogue: 'Elevator bergemuruh naik membawa kamu ke lapisan awan tertinggi.',
    qs: [
      { type:'fill', learnTitle:'Kata Kunci function', learn:'Fungsi standar di JavaScript dideklarasikan dengan kata kunci <code>function</code>.',
        code:'___ hitungPoin(musuh) {\n  return musuh * 50;\n}\nconsole.log(hitungPoin(3));', q:'Ketik kata kunci yang hilang supaya fungsi ini valid.',
        ans:[['function']], run:'150', hint:'Kata kunci yang artinya sama dengan bahasa Inggris "fungsi".', exp:'"function" adalah kata kunci deklarasi fungsi resmi di JavaScript. hitungPoin(3) = 3 * 50 = 150.' },
      { type:'fill', learnTitle:'Ternary Operator ( ? : )', learn:'Ternary adalah bentuk ringkas if-else: <code>kondisi ? benar : salah</code>.',
        code:'let nilai = 85;\nlet status = nilai >= 75 ___ "Lulus" : "Gagal";\nconsole.log(status);', q:'Ketik simbol yang melengkapi sintaks ternary.',
        ans:[['?']], run:'Lulus', hint:'Simbol ini muncul setelah kondisi dan sebelum nilai jika benar.', exp:'Sintaks lengkap ternary adalah kondisi ? nilaiJikaBenar : nilaiJikaSalah. Karena 85 >= 75, hasilnya "Lulus".' },
      { type:'predict', learnTitle:'Perbedaan forEach() vs map()', learn:'<code>.forEach()</code> menjalankan fungsi untuk tiap item tanpa membuat array baru. <code>.map()</code> menghasilkan array baru berisi nilai yang sudah ditransformasi.',
        code:'let angka = [1, 2, 3];\nlet hasil = angka.map(x => x * 10);\nconsole.log(hasil);', q:'Apa isi hasil yang tercetak? Ketik dalam bentuk array.',
        ans:['[10, 20, 30]'], hint:'Setiap angka dikali 10, lalu dikumpulkan jadi array baru.', exp:'.map() mengalikan tiap elemen dengan 10 dan mengembalikannya ke array baru [10, 20, 30].' }
    ]
  },
  {
    title: 'Puncak Master JavaScript', short: 'Destructuring, spread operator, & async / await',
    coords: [5, -3],
    story: 'Puncak tertinggi: <b>PUNCAK MASTER</b>! Bebatuan kristal melayang di langit. <b>Grandmaster Kernel</b> menyambutmu untuk ujian pamungkas!',
    epilogue: 'Cahaya emas membubung ke langit! Kamu resmi menamatkan NgodeTrip 3D dan menjadi Master Kode!',
    qs: [
      { type:'predict', learnTitle:'Object Destructuring', learn:'Destructuring membongkar properti objek langsung ke variabel dengan kurung kurawal <code>{ }</code>.',
        code:'let user = { nama: "Nova", skor: 99 };\nlet { nama } = user;\nconsole.log(nama);', q:'Apa yang tercetak di console?',
        ans:['Nova'], hint:'Variabel nama mengambil properti nama dari objek user.', exp:'Destructuring mengambil properti nama langsung dari objek user.' },
      { type:'predict', learnTitle:'Spread Operator ( ... )', learn:'Tanda titik tiga <code>...</code> membongkar array menjadi argumen individual.',
        code:'let angka = [10, 50, 30];\nconsole.log(Math.max(...angka));', q:'Berapa hasil Math.max di atas?',
        ans:['50'], hint:'Math.max mencari nilai terbesar.', exp:'Math.max(...angka) mengevaluasi angka terbesar dari array, yaitu 50.' },
      { type:'fill', learnTitle:'Asynchronous dengan async & await', learn:'Kata kunci <code>async</code> menandai fungsi asynchronous. <code>await</code> dipakai untuk menunggu hasil Promise selesai sebelum lanjut ke baris berikutnya.',
        code:'async function ambilData() {\n  let res = ___ fetch("https://api.game.id/profil");\n  let data = ___ res.json();\n  return data;\n}', q:'Ketik kata kunci yang sama di kedua kotak agar kode menunggu hasilnya.',
        ans:[['await'],['await']], run:'(data profil berhasil diambil)', hint:'Kata kunci yang artinya "tunggu".', exp:'"await" dipasangkan dengan fungsi yang mengembalikan Promise (fetch dan res.json()) di dalam fungsi async.' }
    ]
  }
  ];

  // Urutan soal TIDAK diacak: mulai dari bab paling dasar (index 0)
  // lalu berurutan mengikuti urutan LEVELS & qs apa adanya.
  var GUARDIAN_NAMES = ['Pak Byte', 'Nyai Sintaks', 'Cyber Spider', 'Kapten Lambda', 'Grandmaster Kernel'];
  var ALL_QUESTIONS = [];
  LEVELS.forEach(function(lvl, ci){
    lvl.qs.forEach(function(q, qi){
      var item = Object.assign({}, q);
      item.chapterIndex = ci; item.chapterTitle = lvl.title; item.guardian = GUARDIAN_NAMES[ci] || 'Penjaga Kode';
      item.story = qi === 0 ? lvl.story : '';                              // cerita bab tampil di soal pertama bab
      item.epilogue = qi === lvl.qs.length-1 ? lvl.epilogue : '';           // epilog tampil di soal terakhir bab
      ALL_QUESTIONS.push(item);
    });
  });
  var qzProgress = 0; // pointer soal berikutnya, maju tiap kristal manapun dipecahkan
  var qzStreak = 0;

  function qzEscapeHtml(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  // Pewarna sintaks satu-lewat. Jika `blanks` diberikan, tiap "___" menjadi kotak isian.
  var QZ_TOKEN = /(\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(let|const|var|function|return|if|else|for|while|async|await)\b|\b(console|log|push|map|max|json|fetch)\b(?=\s*[.(])|\b(\d+(?:\.\d+)?)\b|(___)/g;
  function qzHighlight(code, blanks){
    var out = '', last = 0, m, bi = 0;
    QZ_TOKEN.lastIndex = 0;
    while ((m = QZ_TOKEN.exec(code)) !== null){
      out += qzEscapeHtml(code.slice(last, m.index));
      if (m[6] && blanks){
        var w = Math.max(4, (blanks[bi] ? blanks[bi][0].length : 4) + 2);
        out += '<input class="qz-in" data-i="' + bi + '" style="width:' + w + 'ch" type="text" inputmode="text" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="isian ' + (bi+1) + '">';
        bi++;
      } else {
        var cls = m[1] ? 'qz-cm' : m[2] ? 'qz-str' : m[3] ? 'qz-kw' : m[4] ? 'qz-fn' : m[5] ? 'qz-num' : 'qz-blank';
        out += '<span class="' + cls + '">' + qzEscapeHtml(m[0]) + '</span>';
      }
      last = QZ_TOKEN.lastIndex;
    }
    return out + qzEscapeHtml(code.slice(last));
  }
  function qzShuffleIdx(n){
    var idx = [], i;
    for (i=0;i<n;i++) idx.push(i);
    do {
      for (i=n-1;i>0;i--){ var j = Math.floor(Math.random()*(i+1)), t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    } while (n > 1 && idx.every(function(v, k){ return v === k; }));   // jangan langsung terurut benar
    return idx;
  }

  var LANDMARKS = [
    { name: "Ujung Sungai", x: 0, z: -140 },
    { name: "Landasan Pesawat", x: 140, z: 0 },
    { name: "Plaza Kota", x: 0, z: 0 },
    { name: "Sudut Barat Laut", x: -140, z: -140 },
    { name: "Sudut Timur Laut", x: 140, z: -140 },
    { name: "Sudut Tenggara", x: 140, z: 140 },
    { name: "Pantai Selatan", x: -140, z: 140 }
  ];
  var LM_COLORS = [0x50fa7b, 0x8be9fd, 0xff79c6, 0xbd93f9, 0xf1fa8c, 0xffb86c, 0x6ea8ff];
  var landmarkText = document.getElementById('landmarkText');
  var landmarksFound = 0;
  var crystalGeo = new THREE.OctahedronGeometry(0.9, 0);

  function makeGlowTexture(){
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(64,64,0,64,64,64);
    grd.addColorStop(0,'rgba(255,255,255,1)'); grd.addColorStop(0.35,'rgba(255,255,255,.35)'); grd.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0,0,128,128);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  var glowTex = makeGlowTexture();

  LANDMARKS.forEach(function(lm, idx){
    var col = LM_COLORS[idx % LM_COLORS.length];
    var crystalMat = new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 0.8,
      roughness: 0.15, metalness: 0.7
    });
    var crystal = new THREE.Mesh(crystalGeo, crystalMat);
    crystal.position.set(lm.x, 2.2, lm.z);
    crystal.castShadow = true;
    scene.add(crystal);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 8, 24), new THREE.MeshBasicMaterial({color:0x8be9fd}));
    ring.rotation.x = Math.PI/2;
    ring.position.set(lm.x, 0.15, lm.z);
    scene.add(ring);
    // pengganti PointLight (7 lampu ekstra membebani GPU HP): sprite cahaya + tiang cahaya yang terlihat dari jauh
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: 0.85,
                                                           depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.scale.set(7, 7, 1);
    glow.position.set(lm.x, 2.2, lm.z);
    scene.add(glow);
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.9, 70, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    beam.position.set(lm.x, 35, lm.z);
    scene.add(beam);
    lm.crystal = crystal;
    lm.ring = ring;
    lm.glow = glow;
    lm.beam = beam;
    lm.color = col;
    lm.visited = false;
  });

  function setLandmarkVisible(lm, on){
    lm.crystal.visible = on; lm.ring.visible = on; lm.glow.visible = on; lm.beam.visible = on;
  }
  function updateCrystals(dt){
    var t = performanceNow();
    LANDMARKS.forEach(function(lm){
      if (lm.visited) return;
      lm.crystal.rotation.y += dt * 0.8;
      lm.crystal.position.y = 2.2 + Math.sin(t*2 + lm.x) * 0.15;
      lm.ring.rotation.z += dt * 0.4;
      lm.glow.material.opacity = 0.7 + Math.sin(t*3 + lm.z) * 0.15;
    });
  }
  // kembalikan kemajuan kuis dari simpanan lokal (dipanggil sekali setelah LANDMARKS ada)
  function applySavedQuiz(){
    if (!savedQuiz) return;
    qzProgress = Number(savedQuiz.qzProgress) || 0;
    qzStreak = Number(savedQuiz.qzStreak) || 0;
    if (Array.isArray(savedQuiz.visited)){
      LANDMARKS.forEach(function(lm, i){
        if (savedQuiz.visited[i]){ lm.visited = true; setLandmarkVisible(lm, false); landmarksFound++; }
      });
    }
    landmarkText.textContent = landmarksFound + ' / ' + LANDMARKS.length;
  }
  applySavedQuiz();
  loadRobots();

  // ================= Kristal Coding: tantangan aktif (bukan pilihan ganda) =================
  // Jenis tantangan: fill (ketik bagian yang hilang), predict (tebak output console),
  // tapline (ketuk baris yang ada bug), order (susun baris kode). Tidak bisa asal pencet.
  var qzState = { open:false, landmark:null, question:null, tries:0, done:false, sel:-1, order:[], deck:[] };
  var qzOverlay = document.getElementById('qzOverlay');
  var qzChapterPill = document.getElementById('qzChapterPill');
  var qzStory = document.getElementById('qzStory');
  var qzLearnTitle = document.getElementById('qzLearnTitle');
  var qzLearnText = document.getElementById('qzLearnText');
  var qzCodeBox = document.getElementById('qzCodeBox');
  var qzPrompt = document.getElementById('qzPrompt');
  var qzWork = document.getElementById('qzWork');
  var qzRunBtn = document.getElementById('qzRunBtn');
  var qzConsole = document.getElementById('qzConsole');
  var qzFeedback = document.getElementById('qzFeedback');
  var qzHintBtn = document.getElementById('qzHintBtn');
  var qzNextBtn = document.getElementById('qzNextBtn');
  var qzRetryBtn = document.getElementById('qzRetryBtn');
  var qzCloseBtn = document.getElementById('qzCloseBtn');

  function qzNormOut(s){ return String(s).trim().replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ''); }
  function qzConsoleShow(lines, cls){
    qzConsole.style.display = 'block';
    qzConsole.innerHTML = lines.map(function(l){ return '<div class="' + (cls || 'info') + '">' + qzEscapeHtml(l) + '</div>'; }).join('');
  }

  function openQuiz(lm){
    qzState.open = true;
    qzState.landmark = lm;
    var qi = qzProgress % ALL_QUESTIONS.length;
    qzState.question = ALL_QUESTIONS[qi];
    qzChapterPill.textContent = qzState.question.chapterTitle + ' • Tantangan ' + (qi+1) + '/' + ALL_QUESTIONS.length;
    // berhenti otomatis & lepas kontrol supaya tidak "nyangkut" saat kuis ditutup
    playerState.curSpeed = 0;
    if (currentVehicle) currentVehicle.mesh.userData.curSpeed = 0;
    keys = {}; joy.active = false; stickReset(); setSprint(false);
    renderQuizQuestion();
    qzOverlay.style.display = 'flex';
    if (lm.guardian) actorOnce(lm.guardian, 'Wave');
  }

  function qzRedrawOrder(){
    var q = qzState.question;
    var slot = document.getElementById('qzSlot'), deck = document.getElementById('qzDeck');
    slot.innerHTML = ''; deck.innerHTML = '';
    function chip(i, inSlot, pos){
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'qz-chip';
      b.innerHTML = qzHighlight(q.lines[i]);
      b.onclick = function(){
        if (qzState.done) return;
        if (inSlot) qzState.order.splice(qzState.order.indexOf(i), 1); else qzState.order.push(i);
        qzRedrawOrder();
      };
      return b;
    }
    qzState.order.forEach(function(i, pos){ slot.appendChild(chip(i, true, pos)); });
    qzState.deck.forEach(function(i){ if (qzState.order.indexOf(i) < 0) deck.appendChild(chip(i, false)); });
    if (!qzState.order.length) slot.innerHTML = '<span class="qz-empty">(kosong — ketuk baris di bawah)</span>';
  }

  function renderQuizQuestion(){
    var q = qzState.question, t = q.type;
    qzState.tries = 0; qzState.done = false; qzState.sel = -1; qzState.order = []; qzState.deck = [];
    if (q.story){ qzStory.style.display = 'block'; qzStory.innerHTML = q.story; } else { qzStory.style.display = 'none'; }
    qzLearnTitle.textContent = q.learnTitle;
    qzLearnText.innerHTML = q.learn;
    qzPrompt.textContent = q.q;
    qzFeedback.className = 'qz-feedback'; qzFeedback.innerHTML = '';
    qzConsole.style.display = 'none'; qzConsole.innerHTML = '';
    qzNextBtn.className = 'qz-next-btn';
    qzRetryBtn.className = 'qz-retry-btn';
    qzRunBtn.style.display = 'block';
    qzHintBtn.style.display = 'block';
    qzWork.innerHTML = ''; qzWork.style.display = 'none';
    qzCodeBox.style.display = 'block';
    if (t === 'fill'){
      qzCodeBox.innerHTML = qzHighlight(q.code, q.ans);
      qzCodeBox.querySelectorAll('.qz-in').forEach(function(inp){
        inp.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); qzRun(); } });
        inp.addEventListener('input', function(){ inp.classList.remove('bad', 'good'); });
      });
    } else if (t === 'predict'){
      qzCodeBox.innerHTML = qzHighlight(q.code);
      qzWork.style.display = 'block';
      qzWork.innerHTML = '<div class="qz-answer-label">Console ▸ (ketik hasilnya)</div>' +
        '<input class="qz-answer" id="qzAnswer" type="text" inputmode="text" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="hasil di console…">';
      document.getElementById('qzAnswer').addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); qzRun(); } });
    } else if (t === 'tapline'){
      qzCodeBox.innerHTML = '';
      q.code.split('\n').forEach(function(ln, i){
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'qz-line'; b.setAttribute('data-i', i);
        b.innerHTML = '<span class="qz-ln">' + (i+1) + '</span><span class="qz-lt">' + (qzHighlight(ln) || '&nbsp;') + '</span>';
        b.onclick = function(){
          if (qzState.done) return;
          qzState.sel = i;
          qzCodeBox.querySelectorAll('.qz-line').forEach(function(x){ x.classList.remove('sel'); });
          b.classList.add('sel');
        };
        qzCodeBox.appendChild(b);
      });
    } else if (t === 'order'){
      qzCodeBox.style.display = 'none';
      qzState.deck = qzShuffleIdx(q.lines.length);
      qzWork.style.display = 'block';
      qzWork.innerHTML = '<div class="qz-answer-label">Susunanmu (ketuk baris untuk melepas)</div><div class="qz-slot" id="qzSlot"></div>' +
        '<div class="qz-answer-label">Pilihan baris</div><div class="qz-deck" id="qzDeck"></div>';
      qzRedrawOrder();
    }
    qzOverlay.scrollTop = 0;
    if (!IS_TOUCH){   // di HP jangan langsung munculkan keyboard, biar materi terbaca dulu
      setTimeout(function(){ var i = qzOverlay.querySelector('.qz-in, .qz-answer'); if (i) i.focus({ preventScroll:true }); }, 60);
    }
  }

  // ---- menjalankan / memeriksa jawaban ----
  function qzRun(){
    if (qzState.done) return;
    var q = qzState.question, t = q.type, ok = false, typed = '';
    if (t === 'fill'){
      var ins = qzCodeBox.querySelectorAll('.qz-in'), empty = false;
      ok = true;
      ins.forEach(function(inp, i){
        var v = inp.value.trim();
        if (!v) empty = true;
        var good = q.ans[i].indexOf(v) >= 0;
        inp.classList.toggle('good', good); inp.classList.toggle('bad', !good);
        if (!good) ok = false;
      });
      if (empty){ qzConsoleShow(['Isi semua kotak dulu ya.']); return; }
    } else if (t === 'predict'){
      typed = document.getElementById('qzAnswer').value;
      if (!typed.trim()){ qzConsoleShow(['Ketik dulu hasil yang menurutmu tercetak.']); return; }
      ok = q.ans.some(function(a){ return qzNormOut(a) === qzNormOut(typed); });
    } else if (t === 'tapline'){
      if (qzState.sel < 0){ qzConsoleShow(['Ketuk dulu baris yang menurutmu bermasalah.']); return; }
      ok = qzState.sel === q.ans;
    } else if (t === 'order'){
      if (qzState.order.length < q.lines.length){ qzConsoleShow(['Susun semua baris dulu ya.']); return; }
      ok = qzState.order.every(function(v, i){ return v === i; });
    }
    if (ok) qzSolved(qzState.tries === 0 ? 'perfect' : 'retry'); else qzFailed(typed);
  }

  function qzFailed(typed){
    var q = qzState.question, t = q.type;
    qzState.tries++;
    qzStreak = 0;
    playWrong();
    if (qzState.landmark && qzState.landmark.guardian) actorOnce(qzState.landmark.guardian, 'No');
    if (t === 'predict'){
      qzConsoleShow(['> ' + typed.trim(), '✗ Itu bukan output program ini. Baca kodenya baris demi baris.'], 'err');
    } else if (t === 'fill'){
      qzConsoleShow(['✗ Ada kotak yang belum tepat (ditandai merah). Program belum bisa jalan.'], 'err');
    } else if (t === 'tapline'){
      var bad = qzCodeBox.querySelector('.qz-line.sel');
      if (bad){ bad.classList.remove('sel'); bad.classList.add('bad'); }
      qzState.sel = -1;
      qzConsoleShow(['✗ Bukan baris itu — baris tersebut sudah benar. Coba baris lain.'], 'err');
    } else if (t === 'order'){
      var chips = document.querySelectorAll('#qzSlot .qz-chip');
      chips.forEach(function(c, i){ if (qzState.order[i] !== i) c.classList.add('bad'); });
      qzConsoleShow(['✗ Urutannya belum tepat (baris merah salah posisi). Ketuk untuk melepasnya.'], 'err');
    }
    if (qzState.tries >= 2 && !qzFeedback.classList.contains('show')) qzHint();
    if (qzState.tries >= 3) qzRetryBtn.className = 'qz-retry-btn show';
  }

  function qzHint(){
    var q = qzState.question;
    if (qzState.done) return;
    qzFeedback.className = 'qz-feedback show hint';
    qzFeedback.innerHTML = '💡 ' + qzEscapeHtml(q.hint || 'Baca kodenya pelan-pelan, baris demi baris.');
  }

  // "Lihat jawaban": setelah 3x salah, tunjukkan jawabannya supaya tidak buntu (hadiah kecil)
  function qzReveal(){
    var q = qzState.question, t = q.type;
    if (t === 'fill'){
      qzCodeBox.querySelectorAll('.qz-in').forEach(function(inp, i){ inp.value = q.ans[i][0]; inp.classList.remove('bad'); inp.classList.add('good'); });
    } else if (t === 'predict'){
      document.getElementById('qzAnswer').value = q.ans[0];
    } else if (t === 'tapline'){
      qzCodeBox.querySelectorAll('.qz-line').forEach(function(x){ x.classList.remove('sel', 'bad'); });
      qzCodeBox.querySelectorAll('.qz-line')[q.ans].classList.add('good');
    } else if (t === 'order'){
      qzState.order = q.lines.map(function(_, i){ return i; }); qzRedrawOrder();
    }
    qzSolved('revealed');
  }

  function qzSolved(quality){
    var q = qzState.question, t = q.type, lm = qzState.landmark;
    qzState.done = true;
    var chapterDone = !!q.epilogue && quality !== 'revealed';
    var factor = quality === 'perfect' ? 1 : quality === 'retry' ? 0.6 : 0.25;
    if (quality === 'perfect') qzStreak++; else qzStreak = 0;
    // "hasil jalan" ala terminal
    var res = t === 'predict' ? q.ans[0] : t === 'tapline' ? 'Bug ditemukan di baris ' + (q.ans + 1) + ' ✓' : (q.run || 'Program berjalan tanpa error ✓');
    qzConsoleShow(['> ' + res], 'ok');
    qzCodeBox.querySelectorAll('.qz-in').forEach(function(inp){ inp.disabled = true; inp.classList.add('good'); });
    var ans = document.getElementById('qzAnswer'); if (ans) ans.disabled = true;
    qzRunBtn.style.display = 'none'; qzHintBtn.style.display = 'none';
    qzRetryBtn.className = 'qz-retry-btn';
    var moneyGain = Math.round((75 + Math.min(qzStreak, 5) * 5) * factor) + (chapterDone ? 150 : 0);
    var xpGain = Math.round(20 * factor) + (chapterDone ? 30 : 0);
    qzFeedback.className = 'qz-feedback show ok';
    qzFeedback.innerHTML = (quality === 'revealed' ? '👀 Ini jawabannya — coba pahami dulu, nanti kamu pasti bisa sendiri.' :
        (quality === 'perfect' ? '✓ Sekali jalan langsung benar!' : '✓ Berhasil setelah beberapa percobaan — itu proses belajar.')) +
      (qzStreak >= 2 ? ' 🔥 Beruntun x' + qzStreak : '') +
      ' <span class="qz-exp">' + qzEscapeHtml(q.exp) + '</span>' +
      (chapterDone ? '<span class="qz-exp qz-epi">🏁 Bab tuntas! ' + q.epilogue + '</span>' : '');
    if (quality !== 'revealed'){
      playCorrect();
      if (typeof confetti === 'function') confetti({ particleCount: chapterDone ? 120 : (quality === 'perfect' ? 50 : 25), spread: 70, origin: { y: 0.55 }, zIndex: 300 });
    }
    if (lm.guardian) actorOnce(lm.guardian, chapterDone ? 'Dance' : 'ThumbsUp');
    lm.visited = true;
    landmarksFound++;
    setLandmarkVisible(lm, false);
    score += quality === 'perfect' ? 2 : 1;
    scoreText.textContent = score;
    landmarkText.textContent = landmarksFound + ' / ' + LANDMARKS.length;
    earnMoney(moneyGain);
    addXP(xpGain);
    qzProgress++;
    if (qzProgress % ALL_QUESTIONS.length === 0){
      showToast('Satu putaran materi tuntas — mulai lagi dari dasar untuk lebih mahir 🎓');
    } else {
      showToast('Kristal ' + lm.name + ' pecah! +' + moneyFmt(moneyGain) + ' • +' + xpGain + ' XP');
    }
    qzNextBtn.className = 'qz-next-btn show';
    qzNextBtn.onclick = function(){ closeQuiz(quality !== 'revealed'); };
    saveGame();
    if (landmarksFound >= LANDMARKS.length){
      score += 5;
      scoreText.textContent = score;
      setTimeout(function(){
        showToast('Semua kristal coding pecah! Bonus +5');
        landmarksFound = 0;
        landmarkText.textContent = '0 / ' + LANDMARKS.length;
        // kristal muncul lagi, tapi baru aktif setelah pemain menjauh (agar kuis tidak langsung terbuka lagi)
        LANDMARKS.forEach(function(l){ l.visited = false; l.armed = false; setLandmarkVisible(l, true); });
      }, 400);
    }
  }
  qzRunBtn.onclick = qzRun;
  qzHintBtn.onclick = qzHint;
  qzRetryBtn.onclick = qzReveal;

  // PERBAIKAN: tombol ✕ dulu membuat kuis terbuka lagi di frame berikutnya (pemain masih di dalam radius kristal)
  // sehingga game "terkunci". Sekarang kristal baru aktif lagi setelah pemain menjauh.
  function closeQuiz(correct){
    var lm = qzState.landmark;
    qzState.open = false;
    qzState.landmark = null;
    qzOverlay.style.display = 'none';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (lm) lm.armed = false;
    if (correct && state === 'walking' && playerActor) actorOnce(playerActor, qzStreak >= 3 ? 'Dance' : 'ThumbsUp');
    if (!correct && state === 'walking' && playerActor && qzStreak === 0) actorFace(playerActor, 'Surprised', 1.2);
  }
  qzCloseBtn.onclick = function(){ closeQuiz(false); };

  function checkLandmarks(pos){
    if (qzState.open || garageOpen || bkOpen) return;
    if (pos.y > 6) return;                      // pesawat yang sedang terbang tinggi tidak memicu kuis
    LANDMARKS.forEach(function(lm){
      if (lm.visited) return;
      var d = Math.sqrt(Math.pow(pos.x-lm.x,2) + Math.pow(pos.z-lm.z,2));
      if (lm.armed === false){ if (d > 9) lm.armed = true; return; }
      if (d < 5) openQuiz(lm);
    });
  }

  // ================= day / night cycle =================
  var DAY_LENGTH = 100; // seconds for a full cycle
  var elapsed = 0;
  var skyDay = new THREE.Color(0xbfe6ff);
  var skyNight = new THREE.Color(0x0c1230);
  var fogDay = new THREE.Color(0xdff6ff);
  var fogNight = new THREE.Color(0x0c1230);
  var sunDir = new THREE.Vector3();
  function updateDayNight(dt){
    elapsed += dt;
    var phase = (elapsed % DAY_LENGTH) / DAY_LENGTH; // 0..1
    var sunAngle = phase * Math.PI * 2;
    var sunHeight = Math.sin(sunAngle);
    // matahari & bayangan mengikuti pemain/kendaraan
    sunDir.set(Math.cos(sunAngle)*90, Math.max(sunHeight,0.05)*90 + 10, 40);
    sun.position.copy(focus).add(sunDir);
    sun.target.position.copy(focus);
    var dayFactor = Math.max(0, sunHeight);
    var nightFactor = 1 - dayFactor;
    sun.intensity = (0.15 + dayFactor*0.85) * LIGHT_K;
    hemi.intensity = (0.25 + dayFactor*0.7) * LIGHT_K;
    moonAmbient.intensity = nightFactor*0.35 * LIGHT_K;
    scene.background.copy(skyDay).lerp(skyNight, nightFactor);
    scene.fog.color.copy(fogDay).lerp(fogNight, nightFactor);
    lampLights.forEach(function(pl){ pl.intensity = (nightFactor > 0.55 ? (nightFactor-0.55)/0.45*1.4 : 0) * LAMP_K; });
    lampBulbs.forEach(function(b){ b.material.color.setHex(nightFactor > 0.55 ? 0xffdd88 : 0x554422); });
    setAmbientNight(nightFactor);
    nightWindows.forEach(function(w){ w.material.opacity = nightFactor > 0.5 ? 0.85 : 0; });
  }

  // ================= camera =================
  var camOffset = new THREE.Vector3(0, window.innerWidth < window.innerHeight ? 5.0 : 4.2, window.innerWidth < window.innerHeight ? 9.0 : 7.8);
  function updateCamera(target, yaw, dt, extraHeight){
    var desired = new THREE.Vector3(camOffset.x, camOffset.y + (extraHeight||0), camOffset.z);
    desired.applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    desired.add(target.position);
    camera.position.lerp(desired, Math.min(1, dt*4));
    var lookAt = target.position.clone();
    var lookDir = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    var speedNow = (state === 'driving' && currentVehicle) ? Math.abs(currentVehicle.mesh.userData.curSpeed||0) : Math.abs(playerState.curSpeed||0);
    lookAt.addScaledVector(lookDir, Math.min(3.0, speedNow * 0.35));
    lookAt.y += 1.15;
    // Small speed-dependent camera movement makes motion feel less static.
    var shake = Math.min(0.035, speedNow * 0.0018);
    camera.position.y += Math.sin(gameClock*18) * shake;
    camera.lookAt(lookAt);
  }

  // ================= main loop =================

  function clampToCity(pos){
    pos.x = Math.max(-CITY_HALF, Math.min(CITY_HALF, pos.x));
    pos.z = Math.max(-CITY_HALF, Math.min(CITY_HALF, pos.z));
  }

  function updatePedestrians(dt){
    pedestrians.forEach(function(p){
      var dx = p.target.x - p.mesh.position.x;
      var dz = p.target.z - p.mesh.position.z;
      var d = Math.sqrt(dx*dx+dz*dz);
      if (d < 1.0){
        p.target = randOpenSpot();
      } else {
        p.mesh.position.x += (dx/d) * p.speed * dt;
        p.mesh.position.z += (dz/d) * p.speed * dt;
        p.mesh.rotation.y = yawToward(dx, dz);
      }
      // hanya render & animasikan pejalan kaki yang dekat pemain (hemat draw call di HP)
      var near = p.mesh.position.distanceToSquared(focus) < 75*75;
      p.mesh.visible = near;
      if (near && p.actor && dt > 0) actorUpdate(p.actor, dt);
    });
  }

  // Cari penghalang terdekat di jalur depan (lampu merah, mobil lain, atau mobil pemain)
  function findAheadObstacle(px, pz, dirX, dirZ, selfNc){
    var lookahead = 14, laneHalfWidth = 2.6, best = null;
    function consider(ox, oz, stopBefore, isPlayer){
      var vx = ox - px, vz = oz - pz;
      var fwd = vx*dirX + vz*dirZ;
      if (fwd <= 0 || fwd > lookahead) return;
      var lat = Math.abs(vx*dirZ - vz*dirX);
      if (lat > laneHalfWidth) return;
      var dist = fwd - (stopBefore || 0);
      if (best === null || dist < best.dist) best = { dist: dist, isPlayer: !!isPlayer };
    }
    TRAFFIC_LIGHTS.forEach(function(tl){
      if (tl.state === 'green') return;
      consider(tl.x, tl.z, 3.2, false);
    });
    npcCars.forEach(function(other){ if (other !== selfNc) consider(other.mesh.position.x, other.mesh.position.z, 2.4, false); });
    policeCars.forEach(function(pc){ consider(pc.mesh.position.x, pc.mesh.position.z, 2.4, false); });
    vehicles.forEach(function(v){ if (!v.occupied) consider(v.mesh.position.x, v.mesh.position.z, 2.4, false); });
    if (state === 'driving' && currentVehicle) consider(currentVehicle.mesh.position.x, currentVehicle.mesh.position.z, 2.6, true);
    return best;
  }

  function updateNpcCars(dt){
    npcCars.forEach(function(nc){
      var dx = nc.target.x - nc.mesh.position.x;
      var dz = nc.target.z - nc.mesh.position.z;
      var d = Math.sqrt(dx*dx+dz*dz);
      if (d < 1.5){
        nc.target = randomWaypoint(nc.mesh.position.x, nc.mesh.position.z);
        return;
      }
      var dirX = dx/d, dirZ = dz/d;
      var obstacle = findAheadObstacle(nc.mesh.position.x, nc.mesh.position.z, dirX, dirZ, nc);
      var targetSpeed = nc.speed;
      if (obstacle){
        targetSpeed = obstacle.dist <= 0.4 ? 0 : Math.min(nc.speed, nc.speed * (obstacle.dist / 6));
        if (obstacle.isPlayer && obstacle.dist < 3){
          var now = performanceNow();
          if (!nc.honkCooldown || now > nc.honkCooldown){
            playNpcHonk();
            nc.honkCooldown = now + 3.5 + Math.random()*2;
          }
        }
      }
      if (nc.curSpeed === undefined) nc.curSpeed = nc.speed;
      var accel = targetSpeed > nc.curSpeed ? 4 : 9; // ngerem lebih responsif drpd akselerasi
      var deltaV = Math.max(-accel*dt, Math.min(accel*dt, targetSpeed - nc.curSpeed));
      nc.curSpeed = Math.max(0, nc.curSpeed + deltaV);
      nc.mesh.position.x += dirX * nc.curSpeed * dt;
      nc.mesh.position.z += dirZ * nc.curSpeed * dt;
      if (nc.curSpeed > 0.05) nc.mesh.rotation.y = Math.atan2(dx, dz);
    });
  }

  function checkVehicleCollisions(v, prevPos){
    var mesh = v.mesh;
    var r1 = v.def.radius;
    var startX = prevPos.x, startZ = prevPos.z;
    var endX = mesh.position.x, endZ = mesh.position.z;
    var travel = Math.sqrt((endX-startX)*(endX-startX) + (endZ-startZ)*(endZ-startZ));
    // Sapu (sweep) posisi dalam beberapa langkah kecil sepanjang lintasan frame ini.
    // Kalau cuma dicek di titik akhir saja, kendaraan yang ngebut (turbo) bisa "meloncati"
    // NPC dalam satu frame dan keliatan tembus padahal sebenarnya menabrak.
    var steps = Math.max(1, Math.min(8, Math.ceil(travel / (r1*0.75))));
    var hit = false, hitOther = null, hitT = 1;
    for (var s=1; s<=steps && !hit; s++){
      var t = s/steps;
      var tx = startX + (endX-startX)*t;
      var tz = startZ + (endZ-startZ)*t;
      // vs other vehicles (yang lagi diparkir / tidak dikendarai)
      vehicles.forEach(function(other){
        if (hit || other === v || other.occupied) return;
        var dx = other.mesh.position.x - tx, dz = other.mesh.position.z - tz;
        var d = Math.sqrt(dx*dx+dz*dz);
        if (d < r1 + other.def.radius*0.6){ hit = true; hitOther = other; hitT = t; }
      });
      // vs npc cars (mobil, motor, truk NPC)
      if (!hit) npcCars.forEach(function(nc){
        if (hit) return;
        var dx = nc.mesh.position.x - tx, dz = nc.mesh.position.z - tz;
        var d = Math.sqrt(dx*dx+dz*dz);
        if (d < r1 + 2.2){ hit = true; hitOther = nc; hitT = t; }
      });
    }
    // vs pedestrians (senggol pejalan kaki = pelanggaran)
    if (v.def.domain === 'land'){
      pedestrians.forEach(function(p){
        var dx = p.mesh.position.x - endX, dz = p.mesh.position.z - endZ;
        var d = Math.sqrt(dx*dx+dz*dz);
        if (d < r1 + 0.7 && d > 0.001){
          hit = true;
          p.mesh.position.x += (dx/d) * 3;
          p.mesh.position.z += (dz/d) * 3;
          p.target = randOpenSpot();
        }
      });
    }
    if (hit){
      // Berhentikan kendaraan kita tepat di titik sebelum tabrakan (bukan mundur penuh ke posisi
      // awal frame), supaya kalau nempel di samping NPC yang lagi jalan, kita tetap nempel bukan
      // malah "loncat mundur".
      var stopT = Math.max(0, hitT - (1/steps));
      mesh.position.x = startX + (endX-startX)*stopT;
      mesh.position.z = startZ + (endZ-startZ)*stopT;
      // Dorong & perlambat pihak lain juga, supaya dia tidak diam menembus body kita atau nyelonong terus.
      if (hitOther && hitOther.mesh){
        var pdx = hitOther.mesh.position.x - mesh.position.x, pdz = hitOther.mesh.position.z - mesh.position.z;
        var pd = Math.max(0.15, Math.sqrt(pdx*pdx+pdz*pdz));
        hitOther.mesh.position.x += (pdx/pd) * 1.4;
        hitOther.mesh.position.z += (pdz/pd) * 1.4;
        if (hitOther.curSpeed !== undefined) hitOther.curSpeed *= 0.15;
        if (hitOther.mesh.userData) hitOther.mesh.userData.curSpeed = (hitOther.mesh.userData.curSpeed||0) * 0.15;
      }
      v.health = Math.max(0, v.health - 8);
      if (v.health <= 0 && !v.wrecked){ v.wrecked = true; showToast('🔧 Kendaraan rusak parah! Bawa pelan-pelan ke SPBU untuk diservis.'); }
      updateHealthBar();
      flashDamage(v);
      playThud();
      reportViolation(mesh.position);
    }
    return hit;
  }

  var miniCanvas = document.getElementById('miniMap');
  var miniCtx = miniCanvas.getContext('2d');

  // Extra city props: crosswalks, traffic lights, signs and decorative blocks
  function addBox(x,z,w,h,d,c){
    var m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:c}));
    m.position.set(x,h/2,z); scene.add(m); return m;
  }
  function addCrosswalk(x,z,vertical){
    for(var i=-3;i<=3;i++){
      var g = new THREE.Mesh(new THREE.PlaneGeometry(vertical?0.45:5.2,vertical?5.2:0.45),
        new THREE.MeshBasicMaterial({color:0xf2f2f2}));
      g.rotation.x=-Math.PI/2;
      g.position.set(x+(vertical?i*0.9:0),0.025,z+(vertical?0:i*0.9));
      scene.add(g);
    }
  }
  [-40,0,40].forEach(function(p){ addCrosswalk(p-5,5,false); addCrosswalk(5,p-5,true); });

  // More traffic
  for(var extra=0;extra<6;extra++){
    var ep=roadPositions[Math.floor(Math.random()*roadPositions.length)];
    var ez=(Math.random()-0.5)*170;
    var em=makeCar(npcColors[extra%npcColors.length],0.85);
    em.position.set(ep,0,ez);
    scene.add(em);
    npcCars.push({mesh:em,target:{x:ep,z:(Math.random()-0.5)*170},speed:4.5+Math.random()*3});
  }

  // Garage progression
  var garageData = [
    {name:'Sedan',cost:0},
    {name:'Sport Car',cost:1800},
    {name:'Motor',cost:900},
    {name:'Truk',cost:2500},
    {name:'Pesawat',cost:6000},
    {name:'Perahu',cost:4500}
  ];
  function renderGarage(){
    var list=document.getElementById('garageList'); list.innerHTML='';
    garageData.forEach(function(gd){
      var d=document.createElement('div'); d.className='vehicle-card';
      var locked=!unlocked[gd.name];
      d.innerHTML='<div><strong>'+gd.name+'</strong><span>'+ (locked ? '🔒 '+moneyFmt(gd.cost) : '✅ Terbuka') +'</span></div>';
      var b=document.createElement('button');
      b.textContent=locked?'BELI':'SIAP';
      b.disabled=!locked || money<gd.cost;
      if(locked) b.onclick=function(){
        if(money>=gd.cost){money-=gd.cost;unlocked[gd.name]=true;moneyText.textContent=moneyFmt(money);renderGarage();showToast(gd.name+' terbuka!');}
      };
      d.appendChild(b); list.appendChild(d);
    });
  }
  // PERBAIKAN: saat garasi terbuka, game dulu tetap berjalan (polisi, misi, tombol E masih aktif)
  var garageOpen = false;
  function openGarage(){
    renderGarage();
    document.getElementById('garageModal').style.display='flex';
    garageOpen = true; keys = {}; joy.active = false; stickReset();
  }
  function closeGarageModal(){
    document.getElementById('garageModal').style.display='none';
    garageOpen = false;
  }
  document.getElementById('garageBtn').onclick=openGarage;
  document.getElementById('closeGarage').onclick=closeGarageModal;
  document.getElementById('garageModal').addEventListener('click',function(e){
    if(e.target===this)closeGarageModal();
  });
  window.addEventListener('keydown',function(e){
    if(e.key==='Escape'){ closeGarageModal(); if(qzState.open) closeQuiz(false); if(bkOpen) closeBengkel(); }
  });
  // ================= BENGKEL KODE: mesin puzzle (murni, tanpa DOM) =================
  // Grid: '#' tembok, '.' lantai, 'R' awal robot, 'B' baterai, 'G' garis finis.
  // dir: 0 atas, 1 kanan, 2 bawah, 3 kiri
  var BK_TOOLS = { maju:'maju();', kiri:'belokKiri();', kanan:'belokKanan();', ambil:'ambil();', ulangi:'ulangi(n) { }', jika:'jika (adaBaterai()) { }', selama:'selama (depanKosong()) { }' };
  var BK_LEVELS = [
    { name:'Jalan Lurus', goal:'Antar robot ke 🏁. Susun perintah maju() satu per satu — komputer menjalankannya dari atas ke bawah.',
      grid:['######','#R..G#','######'], dir:1, tools:['maju'], par:3, hint:'Jarak ke 🏁 ada 3 kotak.' },
    { name:'Belokan', goal:'Jalannya berbelok. Gabungkan maju() dengan belokKanan().',
      grid:['#####','#R..#','###.#','#G..#','#####'], dir:1, tools:['maju','kiri','kanan'], par:8, hint:'Maju 2, belok kanan, maju 2, belok kanan, maju 2.' },
    { name:'Ambil Baterai', goal:'Robot butuh 🔋 dulu! Berdiri di atas baterai, lalu panggil ambil() sebelum ke 🏁.',
      grid:['######','#RB.G#','######'], dir:1, tools:['maju','kiri','kanan','ambil'], par:4, hint:'maju, ambil, lalu maju sampai 🏁.' },
    { name:'Perulangan', goal:'Jalannya panjang! Daripada menulis maju() berkali-kali, pakai ulangi(n) { } — atur angka n dengan tombol − dan +.',
      grid:['###########','#R.......G#','###########'], dir:1, tools:['maju','ulangi'], par:3, hint:'Butuh 8 langkah: ulangi(4) berisi 2x maju(), atau ulangi(8) berisi 1x maju().' },
    { name:'Tangga', goal:'Pola yang berulang bisa dibungkus dalam loop. Temukan pola langkahnya!',
      grid:['######','####G#','###..#','##..##','#R.###','######'], dir:1, tools:['maju','kiri','kanan','ulangi'], par:5, hint:'Pola: maju, belokKiri, maju, belokKanan. Ulangi 3 kali.' },
    { name:'Panen Baterai', goal:'Ada 3 baterai berjajar. Gabungkan loop dan ambil() untuk memanen semuanya.',
      grid:['#######','#RBBBG#','#######'], dir:1, tools:['maju','ambil','ulangi'], par:4, hint:'ulangi(3) { maju(); ambil(); } lalu maju() sekali lagi.' },
    { name:'Sampai Tembok', goal:'Panjang lorongnya tidak diketahui... pakai selama (depanKosong()) { } — ulangi terus SELAMA di depan robot masih kosong.',
      grid:['#############','#R.........G#','#############'], dir:1, tools:['maju','selama'], par:2, hint:'selama (depanKosong()) { maju(); }' },
    { name:'Cek Sambil Jalan', goal:'Baterai tersebar acak. Pakai jika (adaBaterai()) { } di dalam loop: robot ambil hanya kalau ada baterai di kotaknya.',
      grid:['############','#R.B..B.B.G#','############'], dir:1, tools:['maju','ambil','ulangi','jika'], par:4, hint:'ulangi(9) { maju(); jika (adaBaterai()) { ambil(); } }' }
  ];
  var BK_DIRS = [[0,-1],[1,0],[0,1],[-1,0]];

  function bkParse(lv){
    var st = { w: lv.grid[0].length, h: lv.grid.length, walls:{}, items:{}, total:0, got:0, x:0, y:0, dir:lv.dir, gx:0, gy:0 };
    lv.grid.forEach(function(row, y){
      row.split('').forEach(function(c, x){
        if (c === '#') st.walls[x+','+y] = true;
        if (c === 'R'){ st.x = x; st.y = y; }
        if (c === 'B'){ st.items[x+','+y] = true; st.total++; }
        if (c === 'G'){ st.gx = x; st.gy = y; }
      });
    });
    return st;
  }
  function bkBlocked(st, x, y){ return x < 0 || y < 0 || x >= st.w || y >= st.h || !!st.walls[x+','+y]; }
  function bkCount(nodes){ var c = 0; nodes.forEach(function(n){ c += 1 + (n.body ? bkCount(n.body) : 0); }); return c; }
  function bkCond(n, st){
    if (n.t === 'jika') return !!st.items[st.x+','+st.y];
    var d = BK_DIRS[st.dir];
    return !bkBlocked(st, st.x + d[0], st.y + d[1]);     // selama (depanKosong())
  }
  // generator: menjalankan program & mengeluarkan {node} tiap perintah, atau {err}
  function* bkExec(nodes, st, ctx){
    for (var i = 0; i < nodes.length; i++){
      var n = nodes[i];
      if (++ctx.ops > 1500){ yield { err:'Programmu berjalan terlalu lama — mungkin ada loop tanpa akhir.', node:n }; return false; }
      if (n.t === 'maju'){
        var d = BK_DIRS[st.dir], nx = st.x + d[0], ny = st.y + d[1];
        if (bkBlocked(st, nx, ny)){ yield { err:'Robot menabrak tembok! 💥', node:n }; return false; }
        st.x = nx; st.y = ny; yield { node:n };
      } else if (n.t === 'kiri'){ st.dir = (st.dir + 3) % 4; yield { node:n }; }
      else if (n.t === 'kanan'){ st.dir = (st.dir + 1) % 4; yield { node:n }; }
      else if (n.t === 'ambil'){
        var k = st.x + ',' + st.y;
        if (st.items[k]){ delete st.items[k]; st.got++; yield { node:n, took:true }; } else { yield { node:n }; }
      } else if (n.t === 'ulangi'){
        for (var r = 0; r < n.n; r++){ var ok = yield* bkExec(n.body, st, ctx); if (ok === false) return false; }
      } else if (n.t === 'jika'){
        if (bkCond(n, st)){ var ok2 = yield* bkExec(n.body, st, ctx); if (ok2 === false) return false; }
        else yield { node:n };
      } else if (n.t === 'selama'){
        var it = 0;
        while (bkCond(n, st) && it++ < 100){
          if (++ctx.ops > 1500){ yield { err:'Programmu berjalan terlalu lama — mungkin ada loop tanpa akhir.', node:n }; return false; }
          if (!n.body.length){ yield { err:'Blok selama masih kosong — isi dengan perintah!', node:n }; return false; }
          var ok3 = yield* bkExec(n.body, st, ctx); if (ok3 === false) return false;
        }
      }
    }
    return true;
  }
  function bkWon(st){ return st.x === st.gx && st.y === st.gy && st.got === st.total; }
  // jalankan sekaligus (dipakai untuk pengujian & pemeriksaan cepat)
  function bkSimulate(lv, prog){
    var st = bkParse(lv), ctx = { ops:0 }, err = null, g = bkExec(prog, st, ctx), r;
    while (!(r = g.next()).done){ if (r.value && r.value.err){ err = r.value.err; break; } }
    return { st:st, err:err, won:!err && bkWon(st) };
  }

  // ================= BENGKEL KODE: tampilan & alur =================
  // Rancang "otak" robot dengan potongan kode nyata (perintah, ulangi, jika, selama) lalu jalankan di arena.
  // Level yang selesai membuka warna baru untuk robot & kendaraanmu (tab Cat & Rakit).
  var BK_COLORS = [
    { name:'Oranye', hex:0xff6a3d, need:-1 }, { name:'Biru', hex:0x3d8bff, need:0 }, { name:'Hijau', hex:0x3ddc84, need:1 },
    { name:'Ungu', hex:0xa06bff, need:2 },   { name:'Emas', hex:0xffc94a, need:3 },  { name:'Pink', hex:0xff6fb5, need:4 },
    { name:'Putih', hex:0xf2f4f8, need:5 },  { name:'Cyan', hex:0x33d6e8, need:6 },  { name:'Merah', hex:0xe5383b, need:7 }
  ];
  function bkColorOpen(c){ return c.need < 0 || !!BK.done[c.need]; }
  function hexCss(h){ return '#' + ('000000' + h.toString(16)).slice(-6); }
  function setActorTint(a, hex){
    if (!a) return;
    a.model.traverse(function(n){ if (n.isMesh && n.material && n.material.name === 'Main') n.material.color.setHex(hex); });
  }
  function applyCarColor(){
    vehicles.forEach(function(v){
      var u = v.mesh.userData;
      if (!u.bodyMesh) return;
      var hex = BK.car == null ? u.origColor : BK.car;
      if (hex == null) return;
      u.bodyMesh.material.color.setHex(hex); u.baseColor = hex;
    });
  }

  function $bk(id){ return document.getElementById(id); }
  var bkLv = 0, bkProg = [], bkTarget = bkProg, bkN = 3, bkRunning = false, bkTimer = 0, bkSt = null, bkAngle = 0, bkLineEls = [], bkWonSession = false;

  function bkContains(nodes, target){
    if (nodes === target) return true;
    for (var i=0;i<nodes.length;i++){ if (nodes[i].body && bkContains(nodes[i].body, target)) return true; }
    return false;
  }
  function bkFindParent(nodes, target){
    for (var i=0;i<nodes.length;i++){
      if (nodes[i].body){
        if (nodes[i].body === target) return nodes;
        var r = bkFindParent(nodes[i].body, target);
        if (r) return r;
      }
    }
    return null;
  }
  function bkFindOwner(nodes, target){
    for (var i=0;i<nodes.length;i++){
      if (nodes[i].body === target) return nodes[i];
      if (nodes[i].body){ var r = bkFindOwner(nodes[i].body, target); if (r) return r; }
    }
    return null;
  }
  function bkLabel(n){
    if (n.t === 'maju') return 'maju();';
    if (n.t === 'kiri') return 'belokKiri();';
    if (n.t === 'kanan') return 'belokKanan();';
    if (n.t === 'ambil') return 'ambil();';
    if (n.t === 'ulangi') return 'ulangi(' + n.n + ') {';
    if (n.t === 'jika') return 'jika (adaBaterai()) {';
    return 'selama (depanKosong()) {';
  }
  function bkHtml(n){
    return bkLabel(n)
      .replace(/^(ulangi|jika|selama)/, '<span class="qz-kw">$1</span>')
      .replace(/^(maju|belokKiri|belokKanan|ambil)/, '<span class="qz-fn">$1</span>')
      .replace(/(adaBaterai|depanKosong)/, '<span class="qz-fn">$1</span>')
      .replace(/\((\d+)\)/, '(<span class="qz-num">$1</span>)');
  }
  function bkStatus(msg, cls){ var s = $bk('bkStatus'); s.className = 'bk-status ' + (cls || ''); s.textContent = msg; }

  function bkRenderGrid(){
    var lv = BK_LEVELS[bkLv];
    bkSt = bkParse(lv);
    bkAngle = lv.dir * 90;
    var grid = $bk('bkGrid');
    var cell = Math.max(24, Math.min(50, Math.floor((Math.min(window.innerWidth, 460) - 72) / bkSt.w)));
    grid.style.setProperty('--cell', cell + 'px');
    grid.style.width = (bkSt.w * cell) + 'px'; grid.style.height = (bkSt.h * cell) + 'px';
    grid.innerHTML = '';
    lv.grid.forEach(function(row, y){
      row.split('').forEach(function(c, x){
        var d = document.createElement('div');
        d.className = 'bk-cell' + (c === '#' ? ' wall' : '');
        d.style.left = (x*cell) + 'px'; d.style.top = (y*cell) + 'px';
        if (c === 'G') d.textContent = '🏁';
        if (c === 'B') d.innerHTML = '<span class="bk-item" data-k="' + x + ',' + y + '">🔋</span>';
        grid.appendChild(d);
      });
    });
    var bot = document.createElement('div');
    bot.id = 'bkBot'; bot.className = 'bk-bot';
    bot.innerHTML = '<span id="bkBotIcon">🤖</span><i class="bk-arrow"></i>';
    grid.appendChild(bot);
    bkDrawBot();
  }
  function bkDrawBot(){
    var grid = $bk('bkGrid'), cell = parseFloat(grid.style.getPropertyValue('--cell'));
    $bk('bkBot').style.transform = 'translate(' + (bkSt.x*cell) + 'px,' + (bkSt.y*cell) + 'px) rotate(' + bkAngle + 'deg)';
    $bk('bkBotIcon').style.transform = 'rotate(' + (-bkAngle) + 'deg)';
  }

  function bkRenderPalette(){
    var el = $bk('bkPalette'); el.innerHTML = '';
    BK_LEVELS[bkLv].tools.forEach(function(t){
      if (t === 'ulangi'){
        var st = document.createElement('span'); st.className = 'bk-step';
        st.innerHTML = '<button type="button" id="bkMinus" aria-label="kurangi">−</button><b id="bkN">' + bkN + '</b><button type="button" id="bkPlus" aria-label="tambah">+</button>';
        el.appendChild(st);
        st.querySelector('#bkMinus').onclick = function(){ bkN = Math.max(2, bkN-1); $bk('bkN').textContent = bkN; };
        st.querySelector('#bkPlus').onclick = function(){ bkN = Math.min(9, bkN+1); $bk('bkN').textContent = bkN; };
      }
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'bk-tool'; b.setAttribute('data-t', t);
      b.innerHTML = bkHtml({ t:t, n:'n' }).replace(/\{$/, '{ }') ;
      if (t === 'ulangi') b.innerHTML = '<span class="qz-kw">ulangi</span>(n) { }';
      if (t === 'jika') b.innerHTML = '<span class="qz-kw">jika</span> (<span class="qz-fn">adaBaterai</span>()) { }';
      if (t === 'selama') b.innerHTML = '<span class="qz-kw">selama</span> (<span class="qz-fn">depanKosong</span>()) { }';
      if (t === 'maju') b.innerHTML = '<span class="qz-fn">maju</span>();';
      b.onclick = function(){ bkAdd(t); };
      el.appendChild(b);
    });
  }
  function bkAdd(t){
    if (bkRunning) return;
    if (bkCount(bkProg) >= 24){ bkStatus('Program sudah terlalu panjang — coba disingkat dengan loop.', 'err'); return; }
    var n = { t:t };
    if (t === 'ulangi') n.n = bkN;
    if (t === 'ulangi' || t === 'jika' || t === 'selama') n.body = [];
    bkTarget.push(n);
    if (n.body) bkTarget = n.body;         // langsung isi di dalam blok yang baru dibuat
    bkStatus('', '');
    bkRenderCode();
  }
  function bkRenderCode(){
    var box = $bk('bkCode'), lv = BK_LEVELS[bkLv];
    box.innerHTML = ''; bkLineEls = [];
    function line(depth, html, o){
      var d = document.createElement('div');
      d.className = 'bk-line' + (o.sel ? ' sel' : '');
      d.style.paddingLeft = (10 + depth*16) + 'px';
      d.innerHTML = '<span class="bk-txt">' + html + '</span>';
      if (o.del){
        var x = document.createElement('button');
        x.type = 'button'; x.className = 'bk-del'; x.textContent = '✕'; x.setAttribute('aria-label', 'hapus baris');
        x.onclick = function(e){ e.stopPropagation(); o.del(); };
        d.appendChild(x);
      }
      if (o.click) d.onclick = o.click;
      box.appendChild(d);
      return d;
    }
    function walk(nodes, depth){
      nodes.forEach(function(n, idx){
        var del = function(){
          if (bkRunning) return;
          nodes.splice(idx, 1);
          if (!bkContains(bkProg, bkTarget)) bkTarget = bkProg;
          bkRenderCode();
        };
        if (n.body){
          var el = line(depth, bkHtml(n), { sel:n.body === bkTarget, del:del, click:function(){ if (!bkRunning){ bkTarget = n.body; bkRenderCode(); } } });
          bkLineEls.push({ node:n, el:el });
          walk(n.body, depth+1);
          if (!n.body.length) line(depth+1, '<span class="qz-cm">// ketuk perintah di atas untuk mengisi blok ini</span>', {});
          line(depth, '}', {});
        } else {
          bkLineEls.push({ node:n, el:line(depth, bkHtml(n), { del:del }) });
        }
      });
    }
    walk(bkProg, 0);
    if (!bkProg.length) line(0, '<span class="qz-cm">// programmu masih kosong — ketuk perintah di atas</span>', {});
    var owner = bkFindOwner(bkProg, bkTarget);
    $bk('bkWhere').textContent = '➕ Menambah ke: ' + (owner ? 'dalam blok ' + owner.t + (owner.t === 'ulangi' ? '(' + owner.n + ')' : '') : 'program utama') +
      '  •  ' + bkCount(bkProg) + ' blok (par ' + lv.par + ')';
  }
  function bkRenderLevels(){
    var el = $bk('bkLevels'); el.innerHTML = '';
    BK_LEVELS.forEach(function(lv, i){
      var open = i === 0 || !!BK.done[i-1];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bk-lv' + (i === bkLv ? ' on' : '') + (BK.done[i] ? ' done' : '') + (open ? '' : ' locked');
      b.innerHTML = (open ? (i+1) : '🔒') + (BK.done[i] ? '<small>' + '★'.repeat(BK.done[i]) + '</small>' : '');
      b.setAttribute('aria-label', 'Level ' + (i+1) + ': ' + lv.name);
      b.onclick = function(){ if (open && !bkRunning) bkSetLevel(i); else if (!open) bkStatus('Selesaikan level sebelumnya dulu.', 'err'); };
      el.appendChild(b);
    });
  }
  function bkSetLevel(i){
    clearTimeout(bkTimer); bkRunning = false;
    bkLv = i; bkProg = []; bkTarget = bkProg;
    var lv = BK_LEVELS[i];
    $bk('bkTitle').textContent = 'Level ' + (i+1) + ': ' + lv.name;
    $bk('bkGoal').textContent = lv.goal;
    $bk('bkFeedback').className = 'qz-feedback'; $bk('bkFeedback').innerHTML = '';
    bkStatus('', '');
    bkRenderLevels(); bkRenderGrid(); bkRenderPalette(); bkRenderCode();
    $bk('bkRun').disabled = false;
  }
  function bkResetRun(){
    clearTimeout(bkTimer); bkRunning = false;
    bkRenderGrid(); bkStatus('', '');
    bkLineEls.forEach(function(x){ x.el.classList.remove('run'); });
    $bk('bkRun').disabled = false;
  }
  function bkRun(){
    if (bkRunning) return;
    if (!bkProg.length){ bkStatus('Programmu masih kosong. Ketuk perintah di atas dulu.', 'err'); return; }
    bkRenderGrid();
    $bk('bkFeedback').className = 'qz-feedback'; $bk('bkFeedback').innerHTML = '';
    bkRunning = true; $bk('bkRun').disabled = true;
    var gen = bkExec(bkProg, bkSt, { ops:0 });
    bkStatus('Menjalankan program…', '');
    function tick(){
      if (!bkRunning) return;
      var r = gen.next();
      bkLineEls.forEach(function(x){ x.el.classList.remove('run'); });
      if (r.done){ bkFinish(null); return; }
      var v = r.value;
      if (v.node){ bkLineEls.forEach(function(x){ if (x.node === v.node) x.el.classList.add('run'); }); }
      if (v.err){ bkFinish(v.err); return; }
      if (v.node && v.node.t === 'kiri') bkAngle -= 90;
      if (v.node && v.node.t === 'kanan') bkAngle += 90;
      if (v.took){ var it = document.querySelector('.bk-item[data-k="' + bkSt.x + ',' + bkSt.y + '"]'); if (it) it.classList.add('got'); }
      bkDrawBot();
      bkTimer = setTimeout(tick, 320);
    }
    tick();
  }
  function bkFinish(err){
    bkRunning = false; $bk('bkRun').disabled = false;
    bkLineEls.forEach(function(x){ x.el.classList.remove('run'); });
    if (err){ bkStatus('✗ ' + err, 'err'); playWrong(); return; }
    if (bkWon(bkSt)){ bkSuccess(); return; }
    var atGoal = bkSt.x === bkSt.gx && bkSt.y === bkSt.gy;
    bkStatus(atGoal ? '✗ Sampai 🏁, tapi baterai baru terambil ' + bkSt.got + '/' + bkSt.total + '. Tambahkan ambil().' : '✗ Robot berhenti sebelum 🏁. Periksa lagi urutan perintahmu.', 'err');
    playWrong();
  }
  function bkSuccess(){
    var lv = BK_LEVELS[bkLv], blocks = bkCount(bkProg);
    var stars = blocks <= lv.par ? 3 : blocks <= lv.par + 2 ? 2 : 1;
    var prev = BK.done[bkLv] || 0, first = !prev;
    BK.done[bkLv] = Math.max(prev, stars);
    var money = first ? 150 + 30*bkLv : (stars > prev ? 50 : 0), xpG = first ? 40 : 0;
    if (money) earnMoney(money);
    if (xpG) addXP(xpG);
    bkWonSession = true;
    bkStatus('✓ Program berhasil!', 'ok');
    var fb = $bk('bkFeedback');
    fb.className = 'qz-feedback show ok';
    var newColor = first ? BK_COLORS.filter(function(c){ return c.need === bkLv; })[0] : null;
    fb.innerHTML = '★'.repeat(stars) + '☆'.repeat(3 - stars) + ' Kamu memakai ' + blocks + ' blok (par ' + lv.par + ').' +
      (stars < 3 ? ' <span class="qz-exp">Bisa lebih ringkas? Coba pakai loop atau kondisi untuk menghemat blok.</span>' : ' <span class="qz-exp">Efisien sekali!</span>') +
      (money ? ' <span class="qz-exp">+' + moneyFmt(money) + (xpG ? ' • +' + xpG + ' XP' : '') + '</span>' : '') +
      (newColor ? '<span class="qz-exp qz-epi">🎨 Warna baru terbuka: <b>' + newColor.name + '</b> — pakai di tab Cat &amp; Rakit.</span>' : '');
    if (bkLv < BK_LEVELS.length - 1){
      var nb = document.createElement('button');
      nb.type = 'button'; nb.className = 'qz-next-btn show'; nb.textContent = 'Level berikutnya ▸';
      nb.onclick = function(){ bkSetLevel(bkLv + 1); };
      fb.appendChild(nb);
    }
    playCorrect();
    if (typeof confetti === 'function') confetti({ particleCount: stars === 3 ? 90 : 45, spread: 70, origin: { y: 0.6 }, zIndex: 300 });
    bkRenderLevels();
    saveGame();
  }

  function bkRenderPaint(){
    function swatches(elId, current, onPick, allowOriginal){
      var el = $bk(elId); el.innerHTML = '';
      if (allowOriginal){
        var o = document.createElement('button');
        o.type = 'button'; o.className = 'bk-sw orig' + (current == null ? ' sel' : ''); o.textContent = '↺';
        o.setAttribute('aria-label', 'warna asli'); o.onclick = function(){ onPick(null); };
        el.appendChild(o);
      }
      BK_COLORS.forEach(function(c){
        var open = bkColorOpen(c);
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'bk-sw' + (current === c.hex ? ' sel' : '') + (open ? '' : ' locked');
        b.style.background = hexCss(c.hex);
        b.setAttribute('aria-label', c.name + (open ? '' : ' (terkunci)'));
        b.title = open ? c.name : 'Selesaikan Level ' + (c.need + 1);
        b.textContent = open ? '' : '🔒';
        b.onclick = function(){ if (open) onPick(c.hex); else $bk('bkPaintNote').textContent = c.name + ' terbuka setelah menyelesaikan Level ' + (c.need + 1) + '.'; };
        el.appendChild(b);
      });
    }
    swatches('bkSwRobot', BK.robot, function(h){ BK.robot = h; setActorTint(playerActor, h); bkRenderPaint(); saveGame(); if (playerActor) actorOnce(playerActor, 'Wave'); }, false);
    swatches('bkSwCar', BK.car, function(h){ BK.car = h; applyCarColor(); bkRenderPaint(); saveGame(); }, true);
    var done = Object.keys(BK.done).length;
    $bk('bkPaintNote').textContent = 'Level selesai: ' + done + '/' + BK_LEVELS.length + ' — tiap level membuka warna baru.';
  }
  function bkTab(which){
    $bk('bkBuild').style.display = which === 'build' ? 'block' : 'none';
    $bk('bkProg').style.display = which === 'prog' ? 'block' : 'none';
    $bk('bkPaint').style.display = which === 'paint' ? 'block' : 'none';
    $bk('bkTabBuild').classList.toggle('on', which === 'build');
    $bk('bkTabProg').classList.toggle('on', which === 'prog');
    $bk('bkTabPaint').classList.toggle('on', which === 'paint');
    if (which === 'paint') bkRenderPaint();
    if (which === 'build') { var f = 0; while (f < BK_STAGES.length - 1 && BK.stages[f+1]) f++; bkBuildSet(bkStage > f ? f : (BK.stages[bkStage+1] ? bkStage : f)); }
  }
  function openBengkel(){
    if (qzState.open || garageOpen) return;
    bkOpen = true; bkWonSession = false;
    keys = {}; joy.active = false; stickReset(); setSprint(false);
    $bk('bkOverlay').style.display = 'flex';
    var first = 0;
    while (first < BK_LEVELS.length - 1 && BK.done[first]) first++;
    bkSetLevel(first);
    bkTab(Object.keys(BK.stages).length < BK_STAGES.length ? 'build' : 'prog');
  }
  function closeBengkel(){
    clearTimeout(bkTimer); bkRunning = false;
    $bk('bkOverlay').style.display = 'none';
    bkOpen = false;
    if (bkWonSession && state === 'walking' && playerActor) actorOnce(playerActor, 'Dance');
  }
  $bk('bengkelBtn').onclick = openBengkel;
  $bk('bkCloseBtn').onclick = closeBengkel;
  $bk('bkTabProg').onclick = function(){ bkTab('prog'); };
  $bk('bkTabPaint').onclick = function(){ bkTab('paint'); };
  $bk('bkRun').onclick = bkRun;
  $bk('bkReset').onclick = bkResetRun;
  $bk('bkUndo').onclick = function(){
    if (bkRunning) return;
    if (bkTarget.length) bkTarget.pop();
    else { var p = bkFindParent(bkProg, bkTarget); bkTarget = p || bkProg; }
    bkRenderCode();
  };
  $bk('bkOut').onclick = function(){
    if (bkRunning) return;
    bkTarget = bkFindParent(bkProg, bkTarget) || bkProg;
    bkRenderCode();
  };
  $bk('bkHint').onclick = function(){
    var fb = $bk('bkFeedback');
    fb.className = 'qz-feedback show hint';
    fb.innerHTML = '💡 ' + qzEscapeHtml(BK_LEVELS[bkLv].hint);
  };
  setActorTint(playerActor, BK.robot);
  applyCarColor();

  // ================= RAKIT DARI NOL: belajar logika lewat merakit mobil =================
  // 10 tahap dari yang paling dasar (variabel) sampai gabungan logika (fungsi + array + loop + if).
  // Kodenya benar-benar DIJALANKAN (bukan cuma dicocokkan), lalu diuji dengan beberapa skenario.
  var BK_COLORNAMES = { merah:0xe5383b, biru:0x3d8bff, hijau:0x3ddc84, kuning:0xf5d000, ungu:0xa06bff, putih:0xf2f4f8, hitam:0x2b2f3a, oranye:0xff6a3d };
  var BK_STAGES = [
    { name:'Variabel', concept:'Variabel itu seperti <b>kotak berlabel</b>. Labelnya adalah nama (misalnya <code>warna</code>), isinya adalah nilai. <code>let</code> berarti "buat kotak baru", dan tanda <code>=</code> berarti "isi kotak dengan…".',
      demo:{ code:'let umur = 12;\nlet nama = "Budi";\nconsole.log(nama + " berumur " + umur);', out:'Budi berumur 12' },
      task:'Beri mobilmu warna dan jumlah roda. Teks harus diapit tanda kutip ("merah"), angka tidak.',
      code:'let warna = ___;\nlet roda = ___;\nconsole.log("Mobilku " + warna + " beroda " + roda);',
      slots:[ { re:'^"[a-z]{3,10}"$', ph:'"merah"', ex:'"merah"' }, { re:'^\\d{1,2}$', ph:'4', ex:'4', num:true } ],
      expose:['warna','roda'],
      checks:[ { label:'warna berupa teks dan dikenali (merah, biru, hijau, kuning, ungu, putih, hitam, oranye)', fn:function(o){ return typeof o.warna === 'string' && BK_COLORNAMES[o.warna] !== undefined; } },
               { label:'roda = 4 (mobil butuh tepat 4 roda)', fn:function(o){ return o.roda === 4; } } ],
      hint:'Ketik "merah" DENGAN tanda kutip untuk warna, dan 4 untuk roda.',
      explain:'Variabel menyimpan nilai supaya bisa dipakai lagi. Teks butuh tanda kutip; angka tidak.',
      onDone:function(o){ BK.build.warna = o.warna; BK.build.roda = o.roda; BK.car = BK_COLORNAMES[o.warna]; applyCarColor(); } },

    { name:'Jenis Data', concept:'Tiap nilai punya jenis: <b>angka</b> (100), <b>teks</b> ("halo", pakai kutip), dan <b>benar/salah</b> (<code>true</code> / <code>false</code>). Komputer memperlakukan tiap jenis berbeda: 5 + 5 = 10, tetapi "5" + "5" = "55"!',
      demo:{ code:'console.log(5 + 5);\nconsole.log("5" + "5");\nconsole.log(typeof "5");', out:'10\n55\nstring' },
      task:'Lengkapi identitas mobil: nama berupa teks, tenaga berupa angka antara 80 dan 200, punyaAtap berupa true atau false.',
      code:'let nama = ___;\nlet tenaga = ___;\nlet punyaAtap = ___;\nconsole.log(typeof nama, typeof tenaga, typeof punyaAtap);',
      slots:[ { re:'^"[A-Za-z0-9 -]{2,14}"$', ph:'"Kurir-1"', ex:'"Kurir-1"' }, { re:'^\\d{2,3}$', ph:'120', ex:'120', num:true }, { re:'^(true|false)$', ph:'true', ex:'true' } ],
      expose:['nama','tenaga','punyaAtap'],
      checks:[ { label:'nama bertipe string (teks)', fn:function(o){ return typeof o.nama === 'string'; } },
               { label:'tenaga bertipe number dan 80–200', fn:function(o){ return typeof o.tenaga === 'number' && o.tenaga >= 80 && o.tenaga <= 200; } },
               { label:'punyaAtap bertipe boolean', fn:function(o){ return typeof o.punyaAtap === 'boolean'; } } ],
      hint:'Contoh: "Kurir-1" (pakai kutip), 120 (tanpa kutip), true (tanpa kutip).',
      explain:'Jenis data menentukan apa yang boleh dilakukan pada nilai itu. Cek jenisnya dengan typeof.',
      onDone:function(o){ BK.build.nama = o.nama; BK.build.tenaga = o.tenaga; BK.build.atap = o.punyaAtap; } },

    { name:'Operator Hitung', concept:'Komputer bisa menghitung: <code>+</code> tambah, <code>-</code> kurang, <code>*</code> kali, <code>/</code> bagi. Hasilnya bisa disimpan lagi ke variabel lain. Urutannya seperti di matematika: kali/bagi dulu, baru tambah/kurang.',
      demo:{ code:'let a = 6;\nlet b = 3;\nlet c = a * b + 2;\nconsole.log(c);', out:'20' },
      task:'Mesin yang kuat itu berat. Pilih berat mesin (minimal 50), tapi jaga kecepatan tetap 8 atau lebih. Perhatikan rumusnya!',
      code:'let tenaga = {{tenaga}};\nlet bodi = 40;\nlet mesin = ___;\nlet berat = bodi + mesin;\nlet kecepatan = tenaga / berat * 10;\nconsole.log("Berat " + berat + ", kecepatan " + kecepatan);',
      slots:[ { re:'^\\d{2,3}$', ph:'50', ex:'50', num:true } ],
      expose:['mesin','berat','kecepatan'],
      checks:[ { label:'mesin minimal 50', fn:function(o){ return o.mesin >= 50; } },
               { label:'kecepatan minimal 8', fn:function(o){ return o.kecepatan >= 8; } } ],
      hint:'Makin berat mesin, makin kecil hasil bagi. Coba mesin 50, lalu naikkan pelan-pelan dan lihat hasilnya.',
      explain:'Rumus di kode adalah "resep" hitungan. Mengubah satu angka mengubah semua hasil turunannya.',
      onDone:function(o){ BK.build.mesin = o.mesin; BK.build.kecepatan = Math.round(o.kecepatan*10)/10; } },

    { name:'Keputusan (if / else)', concept:'<code>if</code> memilih jalan: <b>kalau</b> syaratnya benar, jalankan blok pertama; <b>kalau tidak</b>, jalankan blok <code>else</code>. Syarat memakai pembanding: <code>&gt;</code> lebih besar, <code>&lt;</code> lebih kecil, <code>===</code> sama persis.',
      demo:{ code:'let hujan = true;\nif (hujan) {\n  console.log("Bawa payung");\n} else {\n  console.log("Santai saja");\n}', out:'Bawa payung' },
      task:'Buat starter mobil: jalan hanya kalau bensin cukup. Program akan diuji dengan tangki penuh DAN tangki kosong — dua-duanya harus benar.',
      code:'let bensin = ___;\nlet status;\nif (bensin ___ ___) {\n  status = "siap jalan";\n} else {\n  status = "isi bensin dulu";\n}\nconsole.log(status);',
      slots:[ { re:'^\\d{1,3}$', ph:'50', ex:'50', num:true }, { re:'^(>|<|>=|<=|===)$', ph:'>', ex:'>' }, { re:'^\\d{1,3}$', ph:'10', ex:'10', num:true } ],
      expose:['status'],
      checks:[ { label:'bensin yang kamu isi → "siap jalan"', fn:function(o){ return o.status === 'siap jalan'; } },
               { label:'tangki penuh (100) → "siap jalan"', fn:function(o, l, run){ return run({0:'100'}).out.status === 'siap jalan'; } },
               { label:'tangki kosong (0) → "isi bensin dulu"', fn:function(o, l, run){ return run({0:'0'}).out.status === 'isi bensin dulu'; } } ],
      hint:'Syaratnya harus benar untuk bensin banyak dan salah untuk bensin 0. Coba: bensin > 10.',
      explain:'Program yang baik dites di dua sisi: saat syarat benar DAN saat syarat salah.',
      onDone:function(){ BK.build.starter = true; } },

    { name:'Gabungan Syarat (&& ||)', concept:'Kadang syaratnya lebih dari satu. <code>&&</code> artinya <b>DAN</b> (dua-duanya harus benar). <code>||</code> artinya <b>ATAU</b> (salah satu benar sudah cukup). Ini disebut logika boolean.',
      demo:{ code:'let a = true;\nlet b = false;\nconsole.log(a && b);\nconsole.log(a || b);', out:'false\ntrue' },
      task:'Uji kelayakan mobil. lolosUji: rem DAN lampu harus berfungsi. bolehJalan: cukup salah satu berfungsi. Pilih && atau ||. Program dites untuk semua kombinasi.',
      code:'let rem = {{rem}};\nlet lampu = {{lampu}};\nlet lolosUji = rem ___ lampu;\nlet bolehJalan = rem ___ lampu;\nconsole.log(lolosUji, bolehJalan);',
      vars:{ rem:'true', lampu:'false' },
      slots:[ { re:'^(&&|\\|\\|)$', ph:'&&', ex:'&&' }, { re:'^(&&|\\|\\|)$', ph:'||', ex:'||' } ],
      expose:['lolosUji','bolehJalan'],
      checks:[ { label:'rem ✔ lampu ✔ → lolosUji true, bolehJalan true', fn:function(o, l, run){ var r = run(null, {rem:'true', lampu:'true'}).out; return r.lolosUji === true && r.bolehJalan === true; } },
               { label:'rem ✔ lampu ✘ → lolosUji false, bolehJalan true', fn:function(o, l, run){ var r = run(null, {rem:'true', lampu:'false'}).out; return r.lolosUji === false && r.bolehJalan === true; } },
               { label:'rem ✘ lampu ✘ → lolosUji false, bolehJalan false', fn:function(o, l, run){ var r = run(null, {rem:'false', lampu:'false'}).out; return r.lolosUji === false && r.bolehJalan === false; } } ],
      hint:'DAN = &&, ATAU = ||. lolosUji butuh dua-duanya benar.',
      explain:'Tabel kebenaran: DAN hanya true kalau semuanya true. ATAU true kalau ada satu saja yang true.',
      onDone:function(){ BK.build.lampu = true; BK.build.rem = true; } },

    { name:'Perulangan (for)', concept:'<code>for</code> mengulang perintah otomatis. <code>for (let i = 0; i &lt; 3; i++)</code> artinya: mulai i dari 0, ulangi <b>selama</b> i kurang dari 3, dan tiap putaran i naik 1 — jadi 3 putaran (0, 1, 2).',
      demo:{ code:'for (let i = 0; i < 3; i++) {\n  console.log("Putaran " + i);\n}', out:'Putaran 0\nPutaran 1\nPutaran 2' },
      task:'Pasang roda dengan loop. Isi batas putaran supaya tepat 4 roda terpasang.',
      code:'let roda = 0;\nfor (let i = 0; i < ___; i++) {\n  roda = roda + 1;\n  console.log("Pasang roda ke-" + roda);\n}',
      slots:[ { re:'^\\d{1,2}$', ph:'4', ex:'4', num:true } ],
      expose:['roda'],
      checks:[ { label:'roda terpasang tepat 4', fn:function(o){ return o.roda === 4; } },
               { label:'ada 4 baris "Pasang roda…" di console', fn:function(o, l){ return l.length === 4; } } ],
      hint:'Loop dimulai dari 0 dan berhenti sebelum mencapai batas. Batas 4 → 4 putaran.',
      explain:'Loop menghemat menulis kode yang sama berkali-kali. Perhatikan batasnya: i < 4 berarti 4 putaran.',
      onDone:function(){ BK.build.rodaLoop = true; } },

    { name:'Daftar (Array)', concept:'Array adalah <b>daftar</b> nilai dalam kurung siku: <code>["a", "b"]</code>. <code>.push(x)</code> menambah x di belakang, <code>.length</code> menghitung jumlah isinya, dan <code>.join(", ")</code> menggabungkannya jadi satu teks.',
      demo:{ code:'let buah = ["apel", "jeruk"];\nbuah.push("mangga");\nconsole.log(buah.length);\nconsole.log(buah.join(", "));', out:'3\napel, jeruk, mangga' },
      task:'Daftar komponen mobil masih kurang. Tambahkan "roda" dan "kemudi" hingga jumlahnya 4.',
      code:'let komponen = ["rangka", "mesin"];\nkomponen.push(___);\nkomponen.push(___);\nconsole.log(komponen.length + " komponen: " + komponen.join(", "));',
      slots:[ { re:'^"[a-z]{3,10}"$', ph:'"roda"', ex:'"roda"' }, { re:'^"[a-z]{3,10}"$', ph:'"kemudi"', ex:'"kemudi"' } ],
      expose:['komponen'],
      checks:[ { label:'jumlah komponen = 4', fn:function(o){ return o.komponen.length === 4; } },
               { label:'ada "roda" dan "kemudi"', fn:function(o){ return o.komponen.indexOf('roda') >= 0 && o.komponen.indexOf('kemudi') >= 0; } } ],
      hint:'Ketik "roda" dan "kemudi" dengan tanda kutip.',
      explain:'Array menyimpan banyak nilai sekaligus. Urutannya penting, dihitung dari 0.',
      onDone:function(o){ BK.build.komponen = o.komponen.slice(); } },

    { name:'Fungsi', concept:'Fungsi adalah <b>mesin kecil</b> yang bisa dipakai berulang: kamu masukkan bahan (<b>parameter</b>), ia mengeluarkan hasil lewat <code>return</code>. Tulis rumusnya sekali, pakai berkali-kali dengan angka berbeda.',
      demo:{ code:'function luas(p, l) {\n  return p * l;\n}\nconsole.log(luas(3, 4));\nconsole.log(luas(5, 2));', out:'12\n10' },
      task:'Buat rumus kecepatan mobil: tenaga dibagi berat, lalu dikali 10 (seperti tahap 3). Fungsimu akan dites dengan angka lain yang tidak kamu lihat.',
      code:'function hitungKecepatan(tenaga, berat) {\n  return ___;\n}\nconsole.log(hitungKecepatan(100, 50));\nconsole.log(hitungKecepatan(120, 60));',
      slots:[ { re:'^[a-z0-9_ +\\-*/()%.]{1,30}$', ph:'tenaga / berat * 10', ex:'tenaga / berat * 10', ids:['tenaga','berat'] } ],
      expose:['hitungKecepatan'],
      checks:[ { label:'hitungKecepatan(100, 50) = 20', fn:function(o){ return o.hitungKecepatan(100, 50) === 20; } },
               { label:'hitungKecepatan(90, 30) = 30 (uji angka lain)', fn:function(o){ return o.hitungKecepatan(90, 30) === 30; } } ],
      hint:'Pakai nama parameternya: tenaga / berat * 10',
      explain:'Fungsi membuat rumus bisa dipakai ulang untuk data apa pun — bukan angka yang ditulis mati.',
      onDone:function(){ BK.build.fungsi = true; } },

    { name:'Objek', concept:'Objek mengelompokkan data yang berhubungan dalam satu wadah: <code>{ nama: "Budi", umur: 12 }</code>. Setiap isi punya nama (properti) dan diakses dengan titik: <code>orang.umur</code>. Nilainya bisa diubah.',
      demo:{ code:'let orang = { nama: "Budi", umur: 12 };\norang.umur = orang.umur + 1;\nconsole.log(orang.nama + " sekarang " + orang.umur);', out:'Budi sekarang 13' },
      task:'Kumpulkan data mobil dalam satu objek. Beri tenaga awal dan turbo true, lalu upgrade tenaga supaya total akhirnya minimal 150.',
      code:'let mobil = {\n  nama: "Kurir-1",\n  roda: 4,\n  tenaga: ___,\n  turbo: ___\n};\nmobil.tenaga = mobil.tenaga + ___;\nconsole.log(mobil.nama + " tenaga akhir: " + mobil.tenaga);',
      slots:[ { re:'^\\d{2,3}$', ph:'100', ex:'100', num:true }, { re:'^(true|false)$', ph:'true', ex:'true' }, { re:'^\\d{1,3}$', ph:'50', ex:'50', num:true } ],
      expose:['mobil'],
      checks:[ { label:'turbo bernilai true', fn:function(o){ return o.mobil.turbo === true; } },
               { label:'tenaga akhir minimal 150', fn:function(o){ return o.mobil.tenaga >= 150; } } ],
      hint:'Contoh: tenaga awal 100, turbo true, upgrade 50 → 150.',
      explain:'Objek merapikan data: satu variabel membawa banyak properti yang saling berkaitan.',
      onDone:function(o){ BK.build.turbo = true; BK.build.tenaga = o.mobil.tenaga; } },

    { name:'Logika Gabungan', concept:'Sekarang semuanya digabung: <b>fungsi</b> membuat keputusan dengan <b>if</b>, dipanggil dari dalam <b>loop</b> untuk setiap isi <b>array</b>, hasilnya dikumpulkan di array baru. Inilah cara program sungguhan bekerja.',
      demo:{ code:'function label(n) {\n  if (n > 5) { return "besar"; }\n  return "kecil";\n}\nlet hasil = [];\nlet data = [2, 8];\nfor (let i = 0; i < data.length; i++) {\n  hasil.push(label(data[i]));\n}\nconsole.log(hasil.join(", "));', out:'kecil, besar' },
      task:'Pilih mesin otomatis sesuai beban: beban berat → "diesel", ringan → "bensin". Tentukan batas beban supaya hasilnya bensin, diesel, bensin, diesel.',
      code:'function pilihMesin(beban) {\n  if (beban > ___) {\n    return "diesel";\n  } else {\n    return "bensin";\n  }\n}\nlet daftarBeban = [30, 90, 60, 120];\nlet hasil = [];\nfor (let i = 0; i < daftarBeban.length; i++) {\n  hasil.push(pilihMesin(daftarBeban[i]));\n}\nconsole.log(hasil.join(", "));',
      slots:[ { re:'^\\d{1,3}$', ph:'75', ex:'75', num:true } ],
      expose:['hasil','pilihMesin'],
      checks:[ { label:'hasil = bensin, diesel, bensin, diesel', fn:function(o){ return o.hasil.join(',') === 'bensin,diesel,bensin,diesel'; } } ],
      hint:'Batasnya harus di atas 60 (agar 60 = bensin) tapi di bawah 90 (agar 90 = diesel).',
      explain:'Kamu baru menggabungkan fungsi + if + loop + array — inti dari hampir semua program.',
      onDone:function(){ BK.build.pilihMesin = true; } },

    { name:'Otak Mobil (Autopilot)', concept:'Program bisa <b>mengambil keputusan sendiri</b>. Fungsi <code>otak()</code> menerima data sensor mobil lalu mengembalikan perintah. Yang penting: <b>urutan if</b> menentukan prioritas — aturan paling atas dicek lebih dulu, dan begitu ada yang cocok, fungsi langsung selesai (return).',
      demo:{ code:'function keputusan(hujan, lapar) {\n  if (lapar) {\n    return "makan";\n  }\n  if (hujan) {\n    return "berteduh";\n  }\n  return "jalan";\n}\nconsole.log(keputusan(true, true));\nconsole.log(keputusan(true, false));', out:'makan\nberteduh' },
      task:'Buat otak autopilot. (1) bensin di bawah batas → "keSPBU". (2) polisi mengejar → "berhenti". (3) kondisi mobil rusak → "keSPBU". Selain itu → "keMisi". Kodemu akan menyetir mobil sungguhan di kota — tombol 🤖 AUTO muncul saat kamu menyetir!',
      code:'function otak(bensin, adaPolisi, kondisi) {\n  if (bensin < ___) {\n    return "keSPBU";\n  }\n  if (___) {\n    return "berhenti";\n  }\n  if (kondisi ___ ___) {\n    return "keSPBU";\n  }\n  return "keMisi";\n}',
      slots:[ { re:'^\\d{1,2}$', ph:'20', ex:'20', num:true }, { re:'^[a-zA-Z_!&| ]{1,30}$', ph:'adaPolisi', ex:'adaPolisi', ids:['adaPolisi'] }, { re:'^(<|<=|>|>=|===)$', ph:'<', ex:'<' }, { re:'^\\d{1,2}$', ph:'30', ex:'30', num:true } ],
      expose:['otak'],
      checks:[ { label:'sensor normal (bensin 80, aman, kondisi 90) → "keMisi"', fn:function(o){ return o.otak(80, false, 90) === 'keMisi'; } },
               { label:'bensin 10 → "keSPBU"', fn:function(o){ return o.otak(10, false, 90) === 'keSPBU'; } },
               { label:'bensin 60 → tetap "keMisi" (batas jangan terlalu tinggi)', fn:function(o){ return o.otak(60, false, 90) === 'keMisi'; } },
               { label:'polisi mengejar → "berhenti"', fn:function(o){ return o.otak(80, true, 90) === 'berhenti'; } },
               { label:'kondisi 20 (rusak) → "keSPBU"', fn:function(o){ return o.otak(80, false, 20) === 'keSPBU'; } },
               { label:'bensin 5 + polisi → "keSPBU" (aturan bensin dicek duluan)', fn:function(o){ return o.otak(5, true, 90) === 'keSPBU'; } } ],
      hint:'Contoh: bensin < 20, lalu adaPolisi, lalu kondisi < 30. Urutan if sudah tersusun benar.',
      explain:'Kamu baru membuat "otak": sensor masuk, keputusan keluar. Aturan yang lebih atas punya prioritas lebih tinggi.',
      onDone:function(){ BK.build.autopilot = true; } }
  ];
  var bkStage = 0, bkTries = 0;

  function bkPerks(){ return { n:Object.keys(BK.stages).length }; }
  // ---- PERFORMA DIHITUNG DARI KODEMU ----
  // Fungsi buatanmu (hitungKecepatan, pilihMesin) dijalankan ulang dari kode yang kamu tulis, lalu hasilnya
  // menentukan kecepatan, percepatan, dan konsumsi bensin mobil di dunia game.
  var BK_SPEC = null, BK_SPEC_DIRTY = true;
  function bkGetFn(stageId, name){
    var st = BK_STAGES[stageId - 1], vals = BK.sol[stageId];
    if (!vals) return null;
    var r = bkExecCode(bkStageSource(st, vals), st.expose);
    return (!r.err && typeof r.out[name] === 'function') ? r.out[name] : null;
  }
  function bkSpecs(){
    if (!BK_SPEC_DIRTY && BK_SPEC) return BK_SPEC;
    var b = BK.build, s = { ready:false, speedMul:1, accelMul:1, fuelMul:1, engine:'bensin', lines:[] };
    if (BK.stages[3] && b.mesin != null && b.tenaga){
      s.ready = true;
      var berat = 40 + b.mesin;
      var fn = BK.stages[8] ? bkGetFn(8, 'hitungKecepatan') : null;
      var kec = fn ? fn(b.tenaga, berat) : b.tenaga / berat * 10;
      if (typeof kec !== 'number' || !isFinite(kec)) kec = 10;
      s.lines.push('berat = 40 + mesin(' + b.mesin + ') = ' + berat);
      s.lines.push((fn ? 'hitungKecepatan(' : 'tenaga/berat*10 → (') + b.tenaga + ', ' + berat + ') = ' + (Math.round(kec*10)/10));
      s.speedMul = Math.max(0.9, Math.min(1.5, 0.8 + kec * 0.03));
      s.accelMul = Math.max(0.8, Math.min(1.25, 1.35 - berat / 220));
      s.fuelMul = 0.9 + berat / 900;
      s.lines.push('→ kecepatan ×' + s.speedMul.toFixed(2) + ', percepatan ×' + s.accelMul.toFixed(2) + ' (mobil lebih ringan = lebih lincah)');
      if (BK.stages[9] && b.turbo){
        s.speedMul *= 1.08; s.accelMul *= 1.15; s.fuelMul *= 1.12;
        s.lines.push('turbo aktif: +8% kecepatan, +15% percepatan, +12% bensin');
      }
      var pm = BK.stages[10] ? bkGetFn(10, 'pilihMesin') : null;
      if (pm){
        s.engine = pm(berat);
        s.lines.push('pilihMesin(' + berat + ') = "' + s.engine + '"');
        if (s.engine === 'diesel'){ s.fuelMul *= 0.75; s.speedMul *= 0.93; s.lines.push('→ diesel: −25% bensin, −7% kecepatan'); }
      }
    }
    BK_SPEC = s; BK_SPEC_DIRTY = false;
    return s;
  }
  function bkBuildDefault(name){
    var b = BK.build;
    if (name === 'warna') return JSON.stringify(b.warna || 'merah');
    if (name === 'tenaga') return String(b.tenaga || 100);
    if (name === 'roda') return String(b.roda || 4);
    return '0';
  }
  function bkStageResolve(st, vars){
    return st.code.replace(/\{\{(\w+)\}\}/g, function(_, k){ return (vars && vars[k] !== undefined) ? vars[k] : bkBuildDefault(k); });
  }
  function bkStageSource(st, vals, vars){
    var i = 0;
    return bkStageResolve(st, Object.assign({}, st.vars || {}, vars || {})).replace(/___/g, function(){ return vals[i++]; });
  }
  // Menjalankan kode rakitan sungguhan. Kotak isian sudah divalidasi ketat (angka / teks / operator saja).
  function bkExecCode(src, expose){
    var logs = [];
    var con = { log: function(){ logs.push([].slice.call(arguments).map(function(a){ return typeof a === 'string' ? a : (Array.isArray(a) ? '[' + a.join(', ') + ']' : String(a)); }).join(' ')); } };
    try {
      var body = '"use strict";\n' + src + '\nreturn {' + expose.map(function(n){ return n + ':(typeof ' + n + '!=="undefined"?' + n + ':undefined)'; }).join(',') + '};';
      return { out:(new Function('console', body))(con), logs:logs, err:null };
    } catch(e){ return { out:{}, logs:logs, err:e.name + ': ' + e.message }; }
  }
  function bkCarSVG(b){
    var hex = hexCss(BK_COLORNAMES[b.warna] !== undefined ? BK_COLORNAMES[b.warna] : 0x8a94b8);
    var n = Math.max(0, Math.min(6, b.roda || 0));
    var s = '<svg viewBox="0 0 240 120" class="bk-carsvg" role="img" aria-label="Pratinjau mobil rakitan">';
    s += '<line x1="0" y1="102" x2="240" y2="102" stroke="#3a4766" stroke-width="2"/>';
    s += '<rect x="26" y="58" width="190" height="28" rx="9" fill="' + hex + '" stroke="#0b1224" stroke-width="2"/>';
    s += b.atap === false
      ? '<path d="M78 58 L96 38 L150 38 L172 58 Z" fill="none" stroke="' + hex + '" stroke-width="3" stroke-dasharray="4 3"/>'
      : '<path d="M78 58 L96 34 L150 34 L172 58 Z" fill="' + hex + '" stroke="#0b1224" stroke-width="2"/><path d="M90 56 L102 40 L122 40 L122 56 Z M128 56 L128 40 L146 40 L160 56 Z" fill="#cfe9ff" opacity=".85"/>';
    if (b.mesin) s += '<rect x="176" y="62" width="34" height="20" rx="4" fill="#ffd34d" stroke="#0b1224"/><text x="193" y="76" font-size="9" text-anchor="middle" fill="#0b1224" font-family="monospace">' + (b.tenaga || '') + '</text>';
    if (b.lampu) s += '<circle cx="216" cy="66" r="5" fill="#fff6a8"/><path d="M220 66 L238 60 L238 72 Z" fill="#fff6a8" opacity=".35"/>';
    if (b.turbo) s += '<path d="M26 66 L4 60 L14 72 L4 82 L26 78 Z" fill="#ff8a3d"/>';
    for (var i=0;i<n;i++){
      var x = n === 1 ? 121 : 56 + i * (130 / (n - 1));
      s += '<circle cx="' + x.toFixed(1) + '" cy="88" r="14" fill="#151b2c" stroke="#8be9fd" stroke-width="2"/><circle cx="' + x.toFixed(1) + '" cy="88" r="5" fill="#8be9fd"/>';
    }
    if (!n) s += '<text x="120" y="112" font-size="10" text-anchor="middle" fill="#9aa6c7" font-family="monospace">(belum ada roda)</text>';
    if (b.nama) s += '<text x="120" y="14" font-size="11" text-anchor="middle" fill="#e6ecff" font-family="monospace">' + qzEscapeHtml(b.nama) + '</text>';
    return s + '</svg>';
  }
  function bkBuildChips(){
    var el = $bk('bkStageChips'); el.innerHTML = '';
    BK_STAGES.forEach(function(st, i){
      var open = i === 0 || !!BK.stages[i];   // tahap i (1-based i+1) terbuka jika tahap sebelumnya selesai
      open = i === 0 || !!BK.stages[i];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bk-lv' + (i === bkStage ? ' on' : '') + (BK.stages[i+1] ? ' done' : '') + (open ? '' : ' locked');
      b.innerHTML = (open ? (i+1) : '🔒') + (BK.stages[i+1] ? '<small>✔</small>' : '');
      b.setAttribute('aria-label', 'Tahap ' + (i+1) + ': ' + st.name);
      b.onclick = function(){ if (open) bkBuildSet(i); else $bk('bkStStatus').textContent = 'Selesaikan tahap sebelumnya dulu.'; };
      el.appendChild(b);
    });
  }
  function bkBuildSet(i){
    bkStage = i; bkTries = 0;
    var st = BK_STAGES[i];
    bkBuildChips();
    $bk('bkStTitle').textContent = 'Tahap ' + (i+1) + ': ' + st.name;
    $bk('bkStConcept').innerHTML = st.concept;
    $bk('bkStDemo').innerHTML = '<summary>📖 Contoh dulu (ketuk untuk buka)</summary><div class="qz-code-box">' + qzHighlight(st.demo.code) + '</div><div class="qz-console" style="display:block"><div class="ok">&gt; ' + qzEscapeHtml(st.demo.out).replace(/\n/g, '</div><div class="ok">&gt; ') + '</div></div>';
    $bk('bkStDemo').removeAttribute('open');
    $bk('bkStTask').textContent = '🎯 ' + st.task;
    var codeEl = $bk('bkStCode');
    codeEl.innerHTML = qzHighlight(bkStageResolve(st, null), st.slots.map(function(s){ return [s.ph]; }));
    var saved = BK.sol[i+1];
    codeEl.querySelectorAll('.qz-in').forEach(function(inp, k){
      inp.placeholder = st.slots[k].ph;
      if (st.slots[k].num) inp.setAttribute('inputmode', 'numeric');
      if (saved && saved[k] !== undefined) inp.value = saved[k];
      inp.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); bkStageGo(); } });
    });
    $bk('bkStCon').style.display = 'none'; $bk('bkStCon').innerHTML = '';
    $bk('bkStChecks').innerHTML = '';
    $bk('bkStFeedback').className = 'qz-feedback'; $bk('bkStFeedback').innerHTML = '';
    $bk('bkStStatus').textContent = '';
    $bk('bkStShow').style.display = 'none';
    $bk('bkStRun').style.display = 'block'; $bk('bkStHint').style.display = 'block';
    var doneAlready = !!BK.stages[i+1];
    $bk('bkStRun').textContent = doneAlready ? '▶ Jalankan ulang (coba variasi)' : '▶ Jalankan kode';
    if (doneAlready) $bk('bkStStatus').textContent = 'Tahap ini sudah selesai. Ubah angkanya lalu jalankan ulang untuk melihat pengaruhnya pada performa mobil.';
    bkBuildRefresh();
  }
  function bkBuildRefresh(temp){
    $bk('bkCarBox').innerHTML = bkCarSVG(Object.assign({}, BK.build, temp || {}));
    var sp = bkSpecs();
    $bk('bkPerks').textContent = sp.ready
      ? '📊 Kecepatan ×' + sp.speedMul.toFixed(2) + '  •  Percepatan ×' + sp.accelMul.toFixed(2) + '  •  Bensin ×' + sp.fuelMul.toFixed(2)
      : '📊 Selesaikan Tahap 3 untuk melihat spesifikasi mobilmu.';
    $bk('bkSpec').innerHTML = sp.lines.map(function(l){ return '<div>' + qzEscapeHtml(l) + '</div>'; }).join('');
  }
  function bkStageGo(){
    var st = BK_STAGES[bkStage];
    var inputs = $bk('bkStCode').querySelectorAll('.qz-in'), vals = [], msg = '';
    inputs.forEach(function(inp, k){
      var v = inp.value.trim(), sl = st.slots[k];
      vals.push(v);
      if (msg) return;
      if (!v) msg = 'Isi kotak ke-' + (k+1) + ' dulu (contoh: ' + sl.ph + ').';
      else if (!new RegExp(sl.re).test(v)) msg = 'Format kotak ke-' + (k+1) + ' belum sesuai. Contoh: ' + sl.ph;
      else if (sl.ids){
        var ids = v.match(/[a-zA-Z_]+/g) || [];
        for (var q=0;q<ids.length;q++){ if (sl.ids.indexOf(ids[q]) < 0){ msg = 'Di sini hanya boleh memakai: ' + sl.ids.join(', ') + ' dan angka.'; break; } }
      }
    });
    if (msg){ $bk('bkStStatus').textContent = msg; return; }
    $bk('bkStStatus').textContent = '';
    var res = bkExecCode(bkStageSource(st, vals), st.expose);
    var con = $bk('bkStCon'); con.style.display = 'block';
    var html = res.logs.map(function(l){ return '<div class="info">&gt; ' + qzEscapeHtml(l) + '</div>'; }).join('');
    if (res.err) html += '<div class="err">✗ ' + qzEscapeHtml(res.err) + '</div>';
    con.innerHTML = html || '<div class="info">(tidak ada output)</div>';
    var run = function(slotOv, varOv){
      var v = vals.slice();
      Object.keys(slotOv || {}).forEach(function(k){ v[k] = slotOv[k]; });
      return bkExecCode(bkStageSource(st, v, varOv), st.expose);
    };
    var allOk = !res.err, list = '';
    st.checks.forEach(function(c){
      var ok = false;
      if (!res.err){ try { ok = !!c.fn(res.out, res.logs, run); } catch(e){ ok = false; } }
      if (!ok) allOk = false;
      list += '<li class="' + (ok ? 'ok' : 'no') + '">' + (ok ? '✔ ' : '✘ ') + qzEscapeHtml(c.label) + '</li>';
    });
    $bk('bkStChecks').innerHTML = '<ul class="bk-checks">' + list + '</ul>';
    bkBuildRefresh(res.err ? null : res.out);
    if (allOk) bkStageDone(st, vals, res.out); else bkStageFail(st);
  }
  function bkStageFail(st){
    bkTries++; playWrong();
    if (bkTries >= 2){ var fb = $bk('bkStFeedback'); fb.className = 'qz-feedback show hint'; fb.innerHTML = '💡 ' + qzEscapeHtml(st.hint); }
    if (bkTries >= 3) $bk('bkStShow').style.display = 'block';
  }
  function bkStageShow(){
    var st = BK_STAGES[bkStage];
    $bk('bkStCode').querySelectorAll('.qz-in').forEach(function(inp, k){ inp.value = st.slots[k].ex; });
    $bk('bkStStatus').textContent = 'Ini contoh isian yang benar — tekan Jalankan untuk melihat hasilnya, dan pahami tiap barisnya.';
    $bk('bkStShow').style.display = 'none';
  }
  function bkStageDone(st, vals, out){
    var id = bkStage + 1, first = !BK.stages[id];
    BK.stages[id] = true; BK.sol[id] = vals;
    st.onDone(out);
    var money = first ? 100 + 40*bkStage : 0, xpG = first ? 30 : 0;
    if (money) earnMoney(money);
    if (xpG) addXP(xpG);
    bkWonSession = true;
    playCorrect();
    if (typeof confetti === 'function') confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 }, zIndex: 300 });
    bkBuildRefresh();
    saveGame();
    var fb = $bk('bkStFeedback');
    fb.className = 'qz-feedback show ok';
    fb.innerHTML = '✓ Tahap ' + id + ' selesai! <span class="qz-exp">' + st.explain + '</span>' +
      (money ? '<span class="qz-exp">+' + moneyFmt(money) + ' • +' + xpG + ' XP • bonus performa mobil naik</span>' : '') +
      (id === BK_STAGES.length ? '<span class="qz-exp qz-epi">🏆 Mobilmu selesai dirakit dari nol! Kamu sudah memahami variabel, tipe data, operator, if/else, boolean, loop, array, fungsi, objek, dan logika gabungan. Tes di jalan — mobil lebih cepat dan irit!</span>' : '');
    if (bkStage < BK_STAGES.length - 1){
      var nb = document.createElement('button');
      nb.type = 'button'; nb.className = 'qz-next-btn show'; nb.textContent = 'Tahap berikutnya ▸';
      nb.onclick = function(){ bkBuildSet(bkStage + 1); $bk('bkOverlay').scrollTop = 0; };
      fb.appendChild(nb);
    }
    $bk('bkStRun').textContent = '▶ Jalankan ulang (coba variasi)';
    $bk('bkStHint').style.display = 'none'; $bk('bkStShow').style.display = 'none';
    BK_SPEC_DIRTY = true;
    bkBuildRefresh();
    bkBuildChips();
  }
  $bk('bkStRun').onclick = bkStageGo;
  $bk('bkStShow').onclick = bkStageShow;
  $bk('bkStHint').onclick = function(){
    var fb = $bk('bkStFeedback');
    if (fb.classList.contains('ok')) return;
    fb.className = 'qz-feedback show hint'; fb.innerHTML = '💡 ' + qzEscapeHtml(BK_STAGES[bkStage].hint);
  };
  $bk('bkTabBuild').onclick = function(){ bkTab('build'); };

  // ================= AUTOPILOT: fungsi otak() buatanmu menyetir mobil di kota =================
  // Tiap 0,5 detik otak() dipanggil dengan sensor asli (bensin, adaPolisi, kondisi) dan hasilnya
  // ("keMisi" / "keSPBU" / "berhenti") menentukan tujuan. Rute mengikuti jalan kota.
  var autoOn = false, autoFn = null, autoAction = 'berhenti', autoRoute = [], autoKey = '', autoThinkAt = 0, autoNote = '';
  var autoStuck = { t:0, x:0, z:0 }, autoUiShow = false, autoUiOn = false;
  var autoBtn = document.getElementById('autoBtn'), autoChip = document.getElementById('autoChip');

  function autoCompile(){
    var vals = BK.sol[11];
    if (!vals) return null;
    var r = bkExecCode(bkStageSource(BK_STAGES[10], vals), BK_STAGES[10].expose);
    return (!r.err && typeof r.out.otak === 'function') ? r.out.otak : null;
  }
  function setAuto(on, why){
    if (on){
      if (!BK.stages[11]){ showToast('🔒 Autopilot terbuka setelah Tahap 11 (Otak Mobil) di Bengkel → Rakit dari Nol.'); return; }
      autoFn = autoCompile();
      if (!autoFn){ showToast('Kode otak() bermasalah — perbaiki di Bengkel.'); return; }
      autoOn = true; autoRoute = []; autoKey = ''; autoThinkAt = 0; autoAction = 'berhenti';
      autoStuck.t = 0; autoStuck.x = currentVehicle.mesh.position.x; autoStuck.z = currentVehicle.mesh.position.z;
      showToast('🤖 Autopilot aktif — mobil dikendalikan kodemu! Sentuh joystick untuk mengambil alih.');
    } else {
      if (autoOn && why) showToast(why);
      autoOn = false;
    }
  }
  function autoThink(){
    var v = currentVehicle, act;
    try { act = autoFn(Math.round(fuel), wantedLevel > 0, Math.round(v.health)); } catch(e){ act = 'berhenti'; }
    if (act !== 'keSPBU' && act !== 'keMisi') act = 'berhenti';
    autoNote = '';
    if (act === 'keMisi' && missionState === 'dropoff' && requiredVehicle && v.def.name !== requiredVehicle){
      autoNote = 'misi butuh ' + requiredVehicle; act = 'berhenti';
    }
    if (act !== autoAction){ autoAction = act; autoRoute = []; autoKey = ''; }
    autoChip.textContent = '🤖 otak() → "' + act + '"' + (autoNote ? ' (' + autoNote + ')' : '');
  }
  // Rute: naik ke jalan terdekat → susuri jalan (belok di persimpangan) → masuk tegak lurus ke tujuan.
  function roadFoot(x, z){
    var rx = nearestRoadCoord(x), rz = nearestRoadCoord(z);
    return Math.abs(x - rx) <= Math.abs(z - rz) ? { x:rx, z:z, v:true } : { x:x, z:rz, v:false };
  }
  function autoBuildRoute(px, pz, tx, tz){
    var S = roadFoot(px, pz), T = roadFoot(tx, tz), pts = [S];
    if (S.v && T.v){
      if (S.x !== T.x){ var zr = nearestRoadCoord(S.z); pts.push({ x:S.x, z:zr }, { x:T.x, z:zr }); }
    } else if (S.v && !T.v){ pts.push({ x:S.x, z:T.z }); }
    else if (!S.v && T.v){ pts.push({ x:T.x, z:S.z }); }
    else if (S.z !== T.z){ var xr = nearestRoadCoord(S.x); pts.push({ x:xr, z:S.z }, { x:xr, z:T.z }); }
    pts.push(T, { x:tx, z:tz });
    return pts;
  }
  // titik 7 m di depan (arah ang) terhalang gedung / kendaraan lain?
  function autoBlocked(mesh, ang){
    var px = mesh.position.x - Math.sin(ang) * 7, pz = mesh.position.z - Math.cos(ang) * 7;
    if (isInsideAnyBuilding(px, pz, 1.5)) return true;
    for (var i=0;i<vehicles.length;i++){
      var o = vehicles[i];
      if (o === currentVehicle || o.occupied) continue;
      var dx = o.mesh.position.x - px, dz = o.mesh.position.z - pz;
      if (dx*dx + dz*dz < 12) return true;
    }
    return false;
  }
  var autoRev = 0, autoTries = 0;
  function autoUpdate(dt){
    var v = currentVehicle, mesh = v.mesh;
    autoThinkAt -= dt;
    if (autoThinkAt <= 0){ autoThinkAt = 0.5; autoThink(); }
    if (autoAction === 'berhenti') return { f:0, t:0 };
    if (autoRev > 0){ autoRev -= dt; return { f:-0.6, t:autoRev > 0.6 ? 1 : -1 }; }   // mundur sambil membelok
    var tx, tz;
    if (autoAction === 'keSPBU'){ tx = STATION.x; tz = STATION.z; } else { tx = missionPos.x; tz = missionPos.z; }
    var key = autoAction + ':' + Math.round(tx) + ',' + Math.round(tz);
    if (key !== autoKey || !autoRoute.length){ autoKey = key; autoRoute = autoBuildRoute(mesh.position.x, mesh.position.z, tx, tz); autoTries = 0; }
    var wp = autoRoute[0];
    var dx = wp.x - mesh.position.x, dz = wp.z - mesh.position.z, d = Math.sqrt(dx*dx + dz*dz);
    var last = autoRoute.length === 1;
    var reach = last ? (autoAction === 'keSPBU' ? 5.5 : 3.5) : 6;
    if (d < reach){
      if (last) return { f:0, t:0 };            // tiba: SPBU → diam agar terisi; misi → diproses checkMission
      autoRoute.shift();
      return { f:0.4, t:0 };
    }
    var heading = mesh.rotation.y;
    var err = angleDelta(heading, yawToward(dx, dz));
    var t = Math.max(-1, Math.min(1, err * 1.8));
    var f = Math.max(0.3, 0.85 - Math.abs(err) * 0.5);
    if (autoBlocked(mesh, heading)){            // hindari gedung / kendaraan di depan
      if (!autoBlocked(mesh, heading + 0.7)) t = 1; else if (!autoBlocked(mesh, heading - 0.7)) t = -1; else t = err >= 0 ? 1 : -1;
      f = 0.35;
    }
    // deteksi macet: mundur dulu, menyerah setelah 3 kali
    autoStuck.t += dt;
    if (autoStuck.t > 2.5){
      var mx = mesh.position.x - autoStuck.x, mz = mesh.position.z - autoStuck.z;
      if (mx*mx + mz*mz < 1.5){
        if (++autoTries > 3){ setAuto(false, 'Autopilot macet — dimatikan. Ambil alih dulu ya.'); return { f:0, t:0 }; }
        autoRev = 1.2;
      }
      autoStuck.t = 0; autoStuck.x = mesh.position.x; autoStuck.z = mesh.position.z;
    }
    return { f:f, t:t };
  }
  function autoUI(){
    var show = state === 'driving' && !!currentVehicle && currentVehicle.def.domain === 'land';
    if (show !== autoUiShow){ autoUiShow = show; autoBtn.style.display = show ? 'block' : 'none'; }
    if (autoOn !== autoUiOn || !show){
      autoUiOn = autoOn; autoBtn.classList.toggle('on', autoOn);
      autoChip.style.display = (autoOn && show) ? 'block' : 'none';
    }
  }
  autoBtn.addEventListener('click', function(){ ensureAudio(); setAuto(!autoOn, 'Autopilot dimatikan.'); });
  autoBtn.addEventListener('touchstart', function(e){ e.preventDefault(); ensureAudio(); setAuto(!autoOn, 'Autopilot dimatikan.'); }, {passive:false});

  // Modern minimap: road grid + player + mission + vehicles
  function worldToMini(x,z){
    var s=CITY_HALF*2+20, pad=18;
    return {x:pad+(x+CITY_HALF+10)/s*(256-pad*2),y:pad+(z+CITY_HALF+10)/s*(256-pad*2)};
  }
  function drawMini(){
    var c=miniCtx;
    c.clearRect(0,0,256,256);
    c.fillStyle='#172331'; c.fillRect(0,0,256,256);
    c.strokeStyle='rgba(255,255,255,.12)'; c.lineWidth=8;
    roadPositions.forEach(function(p){
      var a=worldToMini(p,-CITY_HALF), b=worldToMini(p,CITY_HALF);
      c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
      var d=worldToMini(-CITY_HALF,p), e=worldToMini(CITY_HALF,p);
      c.beginPath();c.moveTo(d.x,d.y);c.lineTo(e.x,e.y);c.stroke();
    });
    c.fillStyle='#286c8f';
    var rr=worldToMini(0,-140); c.fillRect(0,rr.y-8,256,16);
    // SPBU
    var sp=worldToMini(STATION.x,STATION.z);
    c.fillStyle='#ff9f43'; c.fillRect(sp.x-4,sp.y-4,8,8);
    // kristal coding
    LANDMARKS.forEach(function(lm){
      if(lm.visited)return;
      var q=worldToMini(lm.x,lm.z);
      c.fillStyle='#50fa7b';
      c.beginPath();c.moveTo(q.x,q.y-6);c.lineTo(q.x+4.5,q.y);c.lineTo(q.x,q.y+6);c.lineTo(q.x-4.5,q.y);c.closePath();c.fill();
    });
    // mission
    var mp=worldToMini(missionPos.x,missionPos.z);
    c.fillStyle=missionState==='pickup'?'#ffd34d':'#55e59a';
    c.beginPath();c.arc(mp.x,mp.y,5,0,Math.PI*2);c.fill();
    // vehicles
    c.fillStyle='#7da7ff';
    vehicles.forEach(function(v){
      if(v.occupied)return;
      var q=worldToMini(v.mesh.position.x,v.mesh.position.z);
      c.fillRect(q.x-1.5,q.y-1.5,3,3);
    });
    // coins
    c.fillStyle='#ffd34d';
    coins.forEach(function(co){
      if(co.collected)return;
      var qc=worldToMini(co.mesh.position.x,co.mesh.position.z);
      c.beginPath();c.arc(qc.x,qc.y,2,0,Math.PI*2);c.fill();
    });
    var target=(state==='driving'&&currentVehicle)?currentVehicle.mesh:player;
    var pp=worldToMini(target.position.x,target.position.z);
    c.save();c.translate(pp.x,pp.y);
    c.rotate(-target.rotation.y);
    c.fillStyle='#ff6578';
    c.beginPath();c.moveTo(0,-7);c.lineTo(5,6);c.lineTo(-5,6);c.closePath();c.fill();
    c.restore();
  }

  // ================= SPBU & bengkel =================
  // PERBAIKAN: bensin dulu hanya bisa berkurang (tidak ada cara mengisi) dan tersimpan di localStorage,
  // jadi setelah habis kendaraan tidak bisa jalan lagi selamanya. Sekarang ada SPBU di dekat Plaza Kota.
  (function buildStation(){
    var padM = new THREE.Mesh(new THREE.PlaneGeometry(15, 11), new THREE.MeshLambertMaterial({ color: 0x8d939c }));
    padM.rotation.x = -Math.PI/2; padM.position.set(STATION.x, 0.03, STATION.z); padM.receiveShadow = true; scene.add(padM);
    var roof = addBox(STATION.x, STATION.z, 12, 0.5, 7, 0xf2f2f2); roof.position.y = 4.4; roof.castShadow = true;
    var stripe = addBox(STATION.x, STATION.z, 12.1, 0.2, 7.1, 0xff5d3b); stripe.position.y = 4.05;
    [[-5.4,-3],[5.4,-3],[-5.4,3],[5.4,3]].forEach(function(p){
      var post = addBox(STATION.x+p[0], STATION.z+p[1], 0.3, 4.2, 0.3, 0xdadada); post.castShadow = true;
    });
    [-2.4, 2.4].forEach(function(dx){
      var pump = addBox(STATION.x+dx, STATION.z, 0.9, 1.6, 0.6, 0xd6342c); pump.castShadow = true;
      var scr = addBox(STATION.x+dx, STATION.z+0.32, 0.5, 0.4, 0.05, 0x55e59a); scr.position.y = 1.2;
    });
    var c = document.createElement('canvas'); c.width = 512; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#ff5d3b'; g.fillRect(0,0,512,128);
    g.fillStyle = '#fff'; g.font = '800 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('⛽ SPBU', 256, 68);
    var tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    var sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false }));
    sign.scale.set(8, 2, 1); sign.position.set(STATION.x, 8.2, STATION.z);
    scene.add(sign);
  })();

  var serviceToastAt = 0;
  function updateService(dt){
    if (dt <= 0) return;
    var driving = (state === 'driving' && currentVehicle);
    var t = driving ? currentVehicle.mesh.position : player.position;
    var dx = t.x - STATION.x, dz = t.z - STATION.z;
    if (dx*dx + dz*dz > STATION.r*STATION.r) return;
    if (driving && Math.abs(currentVehicle.mesh.userData.curSpeed || 0) > 3) return;   // harus pelan
    var cost = 0, did = false;
    if (fuel < 100){ var add = Math.min(100 - fuel, 22*dt); setFuel(fuel + add); cost += add * 0.8; did = true; }
    if (driving && currentVehicle.health < 100){
      var hp = Math.min(100 - currentVehicle.health, 14*dt);
      currentVehicle.health += hp; currentVehicle.wrecked = false; updateHealthBar(); cost += hp * 2; did = true;
    }
    if (did){
      if (cost > 0) earnMoney(-Math.min(money, cost));
      var now = performanceNow();
      if (now - serviceToastAt > 4){ serviceToastAt = now; showToast('⛽ SPBU: isi bensin' + (driving ? ' & servis kendaraan' : '') + '…'); }
    }
  }

  // ================= HUD modern =================
  var lastMiniDraw = 0, fuelWarned = false;
  function updateModernHUD(dt){
    var moving=0;
    if(state==='driving' && currentVehicle){
      moving=Math.abs(currentVehicle.mesh.userData.curSpeed||0);
      if(fuel>0 && moving>0.2) setFuel(fuel-dt*(moving/80)*(boosting?2.2:1)*bkSpecs().fuelMul);
      // PERBAIKAN: peringatan dulu muncul di SETIAP frame saat bensin 0 (toast beruntun tanpa henti)
      if(fuel<=0 && !fuelWarned){ fuelWarned = true; showToast('⛽ Bensin habis! Turun lalu jalan ke SPBU (kotak oranye di peta).'); }
    }
    if(fuel>8) fuelWarned = false;
    speedValue.textContent=Math.round(moving*4.2);
    if(missionDeadline>0){
      var left=Math.max(0,missionDeadline-performanceNow());
      missionTimer.textContent='⏱ '+left.toFixed(0)+' dtk';
      if(left<=0){
        missionDeadline=0; showToast('Waktu misi habis! Coba lagi.');
        placeMission('pickup'); missionState='pickup';
      }
    }
    var nowMs = performance.now();
    if (nowMs - lastMiniDraw > 90){ lastMiniDraw = nowMs; drawMini(); }   // minimap tidak perlu digambar 60x/detik
  }
  // waktu game: berhenti saat kuis / garasi terbuka (dulu memakai jam nyata sehingga misi & polisi tetap berjalan)
  function performanceNow(){ return gameClock; }


  // Local save: saldo, level, XP, bensin, kendaraan terbuka, skor & kemajuan kristal coding
  function saveGame(){
    try{
      localStorage.setItem('jjc20',JSON.stringify({
        money:money, xp:xp, level:level, fuel:fuel, unlocked:unlocked,
        score:score, qzProgress:qzProgress, qzStreak:qzStreak,
        visited:LANDMARKS.map(function(l){ return !!l.visited; }),
        bk:BK
      }));
    }catch(e){}
  }
  function loadGame(){
    try{
      var s=JSON.parse(localStorage.getItem('jjc20')||'null');
      if(!s)return;
      money=Number(s.money)||0; xp=Number(s.xp)||0; level=Number(s.level)||1; fuel=s.fuel==null?100:Number(s.fuel);
      if(fuel<25) fuel=25;                       // jangan sampai game terkunci karena bensin kosong
      score=Number(s.score)||0; scoreText.textContent=score;
      savedQuiz=s;
      if(s.bk){ BK.done=s.bk.done||{}; BK.robot=s.bk.robot==null?0xff6a3d:s.bk.robot; BK.car=s.bk.car==null?null:s.bk.car; BK.stages=s.bk.stages||{}; BK.build=s.bk.build||{}; BK.sol=s.bk.sol||{}; }                               // kemajuan kristal diterapkan setelah LANDMARKS dibuat
      if(s.unlocked) Object.keys(s.unlocked).forEach(function(k){unlocked[k]=!!s.unlocked[k]});
      moneyText.textContent=moneyFmt(money); levelText.textContent=level; setFuel(fuel);
      xpBar.style.width=Math.min(100,xp/xpNeed()*100)+'%';
    }catch(e){}
  }
  setInterval(saveGame,5000);
  window.addEventListener('beforeunload',saveGame);
  document.addEventListener('visibilitychange',function(){ if(document.hidden) saveGame(); });   // HP sering tidak memicu beforeunload

  // versi PWA: beri tahu pemain saat game sudah tersimpan untuk dimainkan tanpa internet
  window.addEventListener('jjc-offline-ready', function(){ showToast('✅ Siap dimainkan tanpa internet!'); });


  var lastFrameMs = 0;
  function animate(nowMs){
    requestAnimationFrame(animate);
    nowMs = nowMs || performance.now();
    var realDt = Math.min(0.05, Math.max(0, (nowMs - lastFrameMs)/1000));
    lastFrameMs = nowMs;
    // kuis / garasi terbuka = dunia berhenti (misi, polisi, bensin, hari-malam ikut berhenti)
    var frozen = qzState.open || garageOpen || bkOpen;
    var dt = frozen ? 0 : realDt;
    gameClock += dt;
    focus.copy((state === "driving" && currentVehicle) ? currentVehicle.mesh.position : player.position);

    updateDayNight(dt);
    updatePedestrians(dt);
    updateTrafficLights(dt);
    updateNpcCars(dt);
    updatePoliceCars(dt);
    updateModernHUD(dt);
    updateCrystals(dt);

    var forwardInput = 0, turnInput = 0;
    if (keys['w'] || keys['arrowup']) forwardInput += 1;
    if (keys['s'] || keys['arrowdown']) forwardInput -= 1;
    if (keys['a'] || keys['arrowleft']) turnInput += 1;
    if (keys['d'] || keys['arrowright']) turnInput -= 1;
    if (Math.abs(joy.y) > 0.08) forwardInput += -joy.y;
    if (Math.abs(joy.x) > 0.08) turnInput += -joy.x;
    forwardInput = Math.max(-1, Math.min(1, forwardInput));
    turnInput = Math.max(-1, Math.min(1, turnInput));

    // AUTOPILOT: kode otak() buatanmu menyetir; sentuhan joystick / tombol mengambil alih
    var manualIn = Math.abs(forwardInput) > 0.1 || Math.abs(turnInput) > 0.1;
    if (autoOn){
      if (state !== 'driving' || !currentVehicle) setAuto(false);
      else if (manualIn) setAuto(false, 'Autopilot dimatikan — kamu mengambil alih.');
      else if (!frozen){ var ad = autoUpdate(dt); forwardInput = ad.f; turnInput = ad.t; }
      else { forwardInput = 0; turnInput = 0; }
    }
    autoUI();

    // LARI / TURBO: tahan tombol (atau Shift), habiskan stamina, isi ulang saat dilepas
    if (sprintLocked && stamina > 25) sprintLocked = false;
    sprinting = (sprintHeld || keys['shift']) && forwardInput > 0.05 && !sprintLocked && stamina > 0 && !frozen;
    if (sprinting){ stamina = Math.max(0, stamina - (state === 'driving' ? 18 : 24) * dt); if (stamina <= 0) sprintLocked = true; }
    else if (!frozen){ stamina = Math.min(100, stamina + 14 * dt); }
    boosting = sprinting && state === 'driving';
    var sprintLabel = state === 'driving' ? 'TURBO' : 'LARI';
    if (sprintBtn.textContent !== sprintLabel) sprintBtn.textContent = sprintLabel;
    sprintBtn.style.setProperty('--st', stamina.toFixed(0) + '%');
    sprintBtn.style.opacity = sprintLocked ? '0.6' : '1';

    if (state === "walking"){
      if (Math.abs(turnInput) > 0.01) player.rotation.y += turnInput * playerState.turnSpeed * dt * Math.min(1, 0.4 + Math.abs(playerState.curSpeed)/playerState.speed*0.6);
      var targetSpeed = forwardInput * playerState.speed * (sprinting ? 2 : 1);
      var rate = (Math.abs(targetSpeed) > Math.abs(playerState.curSpeed) ? playerState.accel : playerState.decel) * (sprinting ? 1.6 : 1);
      playerState.curSpeed += Math.sign(targetSpeed - playerState.curSpeed) * Math.min(Math.abs(targetSpeed - playerState.curSpeed), rate * dt);
      if (Math.abs(playerState.curSpeed) > 0.03){
        var dir = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), player.rotation.y);
        player.position.addScaledVector(dir, playerState.curSpeed * dt);
        clampToCity(player.position);
        resolveBuildingCollision(player.position, PLAYER_RADIUS);
        resolveVehicleCollisionForWalker(player.position, PLAYER_RADIUS);
        footstepAcc += Math.abs(playerState.curSpeed) * dt;
        if (footstepAcc > 1.1){ footstepAcc = 0; playFootstep(sprinting); }
        if (!playerActor){                       // karakter cadangan (sebelum robot dimuat)
          walkCycle += dt * (3 + Math.abs(playerState.curSpeed) * 1.4);
          var swing = Math.sin(walkCycle) * Math.min(1, Math.abs(playerState.curSpeed)/playerState.speed) * 0.6;
          pLegL.rotation.x = swing; pLegR.rotation.x = -swing;
          pArmR.rotation.x = swing; pArmL.rotation.x = -swing;
          pBody.position.y = 1.15 + Math.abs(Math.sin(walkCycle*2)) * 0.03;
        }
      } else if (!playerActor){
        walkCycle *= 0.9;
        pLegL.rotation.x *= 0.8; pLegR.rotation.x *= 0.8;
        pArmL.rotation.x *= 0.8; pArmR.rotation.x *= 0.8;
      }
      checkMission(player.position);
      checkLandmarks(player.position);
      updateCoins(dt, player.position);
      var res = nearestVehicle();
      if (res.vehicle && res.dist < res.vehicle.def.enterDist + 1.2){
        promptBanner.style.display = 'block';
        promptAction.textContent = 'naik ' + res.vehicle.def.name;
      } else {
        promptBanner.style.display = 'none';
      }
      updateCamera(player, player.rotation.y, dt, 0);
    } else if (state === "driving" && currentVehicle){
      var v = currentVehicle;
      var mesh = v.mesh;
      var isPlane = v.def.domain === 'air';
      var prevPos = mesh.position.clone();

      if (Math.abs(turnInput) > 0.01 && (Math.abs(forwardInput) > 0.05 || isPlane)){
        mesh.rotation.y += turnInput * mesh.userData.turnSpeed * dt * (isPlane ? 1 : Math.sign(forwardInput));
      }
      // kendaraan rusak (kondisi 0) masih bisa "pincang" ke SPBU untuk diservis
      var limp = v.health <= 0 ? 0.35 : 1;
      var targetVSpeed = (fuel > 0 ? forwardInput : 0) * mesh.userData.speed * limp * (boosting ? 1.5 : 1) * bkSpecs().speedMul;
      var curV = mesh.userData.curSpeed || 0;
      var vRate = ((Math.abs(targetVSpeed) > Math.abs(curV) ? mesh.userData.accel : mesh.userData.decel) || 6) * (boosting ? 1.6 : 1) * bkSpecs().accelMul;
      curV += Math.sign(targetVSpeed - curV) * Math.min(Math.abs(targetVSpeed - curV), vRate * dt);
      mesh.userData.curSpeed = curV;
      var speedFrac = mesh.userData.speed ? curV / mesh.userData.speed : 0;
      if (v.def.domain === 'land' && Math.abs(speedFrac) > 0.88){
        speedingAcc += dt;
        if (speedingAcc > 0.6){ speedingAcc = 0; reportViolation(mesh.position); }
      } else {
        speedingAcc = 0;
      }
      if (Math.abs(curV) > 0.02){
        var vdir = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), mesh.rotation.y);
        mesh.position.addScaledVector(vdir, curV * dt);
        mesh.rotation.z += (turnInput * 0.035 * Math.sign(curV||1) - mesh.rotation.z) * Math.min(1,dt*5);
        clampToCity(mesh.position);
      } else {
        mesh.rotation.z += (0 - mesh.rotation.z) * Math.min(1,dt*5);
      }

      if (isPlane){
        var groundSpeed = Math.abs(mesh.userData.curSpeed||0);
        var targetAlt = groundSpeed > 12 ? 22 : 0;
        mesh.userData.altitude = mesh.userData.altitude || 0;
        mesh.userData.altitude += (targetAlt - mesh.userData.altitude) * Math.min(1, dt*0.6);
        mesh.position.y = Math.max(0, mesh.userData.altitude);
      } else if (v.def.domain !== 'water'){
        resolveBuildingCollision(mesh.position, v.def.radius*0.5);
      }

      if (!isPlane || mesh.position.y < 1){
        checkVehicleCollisions(v, prevPos);
      }

      checkMission(mesh.position);
      checkLandmarks(mesh.position);
      updateCoins(dt, mesh.position);
      updateEngineSound(speedFrac, turnInput);
      promptBanner.style.display = (isPlane && mesh.position.y > 2) ? 'none' : 'block';
      promptAction.textContent = 'turun';
      updateCamera(mesh, mesh.rotation.y, dt, isPlane ? mesh.position.y*0.4 : 0);
    }

    // sensasi kecepatan: sudut pandang melebar saat lari / turbo
    var targetFov = sprinting ? 71 : 62;
    if (Math.abs(camera.fov - targetFov) > 0.05){
      camera.fov += (targetFov - camera.fov) * Math.min(1, realDt*6);
      camera.updateProjectionMatrix();
    }
    updateService(dt);
    updateActors(realDt);
    if (realCarMixers.length) realCarMixers.forEach(function(m){ m.update(dt); });
    renderer.render(scene, camera);
  }
  
  requestAnimationFrame(animate);

}

bootGame();