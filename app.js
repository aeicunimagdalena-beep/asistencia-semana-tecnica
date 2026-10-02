/* ============================================================
 *  Control de Asistencia — app.js
 *  Fase 5: escáner en MODO VERIFICACIÓN (no registra asistencia)
 * ============================================================ */
(function () {
  'use strict';

  /* ===== Configuración ===== */
  var API_URL = 'https://script.google.com/macros/s/AKfycbwZVGNaEQ2-0Wbp7umi8O6niq4VS7rxmOLn2Gw95kd6t211WkjJc4vPGP2snJXwCpOr6Q/exec';

  // Fase 5: 'identificar' (solo verifica). Fase 6: cambiar a 'registrar'.
  var ACCION_ESCANEO = 'identificar';

  var PREFIJO_QR = 'EVT1:';
  var TIMEOUT_MS = 15000;          // espera máxima por respuesta del servidor
  var INTERVALO_ESTADO_MS = 30000; // cada cuánto se consulta la jornada
  var PAUSA_MISMO_QR_MS = 3000;    // tras un resultado, ignora el mismo QR este tiempo

  var LS = {
    sesion: 'asis.sesion',
    dispositivo: 'asis.dispositivo',
    sonido: 'asis.sonido',
    contador: 'asis.contador'
  };

  var $ = function (id) { return document.getElementById(id); };

  var st = {
    sesion: null, rol: null, dispositivo: '',
    jornada: null, proxima: null,
    ocupado: false, modal: false,
    camara: false, stream: null, reanudar: false,
    ultimo: '', ultimoT: 0,
    sonido: true, audio: null, wake: null,
    intervalo: null, timerResultado: null, accionVisor: null
  };

  var lienzo = document.createElement('canvas');
  var ctx = lienzo.getContext('2d', { willReadFrequently: true });

  /* ===== Estados visuales ===== */
  var VISUAL = {
    REGISTRADO:     { clase: 'exito', icono: '✓', titulo: 'ASISTENCIA REGISTRADA', detalle: '', tiempo: 1400, sonido: 'exito' },
    VALIDO:         { clase: 'info',  icono: '✓', titulo: 'CÓDIGO VÁLIDO', detalle: 'Modo verificación: no se registró asistencia', tiempo: 1800, sonido: 'exito' },
    YA_REGISTRADO:  { clase: 'aviso', icono: '⚠', titulo: 'YA REGISTRADO', detalle: 'Ya registró asistencia en esta jornada.', tiempo: 2600, sonido: 'aviso' },
    PAGO_PENDIENTE: { clase: 'aviso', icono: '⚠', titulo: 'PAGO PENDIENTE', detalle: 'Su pago aún no ha sido verificado.\nRemítelo a la mesa del comité.', tiempo: 3500, sonido: 'error' },
    ANULADO:        { clase: 'error', icono: '✕', titulo: 'INSCRIPCIÓN ANULADA', detalle: 'Remítelo a la mesa del comité.', tiempo: 3500, sonido: 'error' },
    NO_ENCONTRADO:  { clase: 'error', icono: '✕', titulo: 'CÓDIGO NO VÁLIDO', detalle: 'No se encontró ningún participante con este código.', tiempo: 2600, sonido: 'error' },
    QR_AJENO:       { clase: 'error', icono: '✕', titulo: 'CÓDIGO NO VÁLIDO', detalle: 'Este QR no pertenece al evento.', tiempo: 2200, sonido: 'error' },
    SIN_JORNADA:    { clase: 'aviso', icono: '⚠', titulo: 'NO HAY JORNADA ACTIVA', detalle: 'En este momento no se puede registrar asistencia.', tiempo: 3000, sonido: 'aviso' },
    ERROR:          { clase: 'error', icono: '✕', titulo: 'NO SE PUDO PROCESAR', detalle: 'Intenta de nuevo.', tiempo: 3500, sonido: 'error' }
  };

  /* ===== Almacenamiento local ===== */
  function leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function borrar(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ===== Vistas y mensajes ===== */
  function mostrarVista(id) {
    ['vistaCarga', 'vistaIngreso', 'vistaEscaner'].forEach(function (v) { $(v).hidden = (v !== id); });
  }

  function mensaje(id, tipo, texto) {
    var el = $(id);
    if (!texto) { el.hidden = true; return; }
    el.className = 'mensaje ' + tipo;
    el.textContent = texto;
    el.hidden = false;
  }

  function visor(texto, boton, accion) {
    if (!texto) { $('visorMensaje').hidden = true; return; }
    $('visorTexto').textContent = texto;
    var b = $('btnCamara');
    b.hidden = !boton;
    if (boton) b.textContent = boton;
    st.accionVisor = accion || null;
    $('visorMensaje').hidden = false;
  }

  /* ===== Comunicación con el servidor ===== */
  function fallo(codigo, texto) {
    var e = new Error(texto);
    e.codigo = codigo;
    return e;
  }

  function api(accion, datos) {
    var cuerpo = { accion: accion, sesion: st.sesion };
    if (datos) {
      for (var k in datos) {
        if (Object.prototype.hasOwnProperty.call(datos, k)) cuerpo[k] = datos[k];
      }
    }
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);

    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(cuerpo),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw fallo('RED', 'El servidor respondió con un error (' + r.status + '). Intenta de nuevo.');
      return r.json().catch(function () {
        throw fallo('RED', 'Respuesta no válida del servidor. Avisa al administrador.');
      });
    }, function (e) {
      clearTimeout(timer);
      throw fallo('RED', e && e.name === 'AbortError'
        ? 'El servidor tardó demasiado en responder. Intenta de nuevo.'
        : 'Sin conexión con el servidor. Revisa los datos móviles.');
    }).then(function (res) {
      if (!res || !res.ok) {
        throw fallo((res && res.codigo) || 'SERVIDOR', (res && res.error) || 'Respuesta inesperada del servidor.');
      }
      return res.datos;
    });
  }

  /* ===== Inicio ===== */
  function iniciar() {
    st.sonido = leer(LS.sonido) !== 'no';
    pintarSonido();
    $('inDispositivo').value = leer(LS.dispositivo) || '';
    pintarContador();

    var verificacion = ACCION_ESCANEO !== 'registrar';
    $('modoPrueba').hidden = !verificacion;
    $('btnCodigoEnviar').textContent = verificacion ? 'Verificar' : 'Registrar';

    enlazarEventos();

    if (API_URL.indexOf('https://script.google.com/') !== 0) {
      mostrarVista('vistaIngreso');
      mensaje('ingresoMensaje', 'error', 'Falta configurar la dirección del servidor (API_URL) en app.js.');
      $('btnIngresar').disabled = true;
      return;
    }

    st.sesion = leer(LS.sesion);
    if (!st.sesion) { mostrarVista('vistaIngreso'); return; }

    mostrarVista('vistaCarga');
    api('verificarSesion').then(function (d) {
      entrar(d, false);
    }).catch(function (e) {
      if (e.codigo === 'SESION') { salir(e.message); return; }
      mostrarVista('vistaIngreso');
      mensaje('ingresoMensaje', 'error', e.message);
    });
  }

  function ingresar() {
    var disp = $('inDispositivo').value.trim();
    var pin = $('inPin').value.trim();
    mensaje('ingresoMensaje');

    if (!disp) { mensaje('ingresoMensaje', 'error', 'Escribe un nombre para este dispositivo, por ejemplo "Celular 1".'); return; }
    if (!pin) { mensaje('ingresoMensaje', 'error', 'Escribe el PIN de acceso.'); return; }

    prepararAudio();
    var btn = $('btnIngresar');
    btn.disabled = true;
    btn.textContent = 'Ingresando…';
    st.sesion = null;

    api('iniciarSesion', { pin: pin, dispositivo: disp }).then(function (d) {
      st.sesion = d.sesion;
      guardar(LS.sesion, d.sesion);
      guardar(LS.dispositivo, d.dispositivo);
      $('inPin').value = '';
      entrar(d, true);
    }).catch(function (e) {
      mensaje('ingresoMensaje', 'error', e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    });
  }

  function entrar(d, conGesto) {
    st.rol = d.rol;
    st.dispositivo = d.dispositivo;
    if (d.evento && d.evento.nombre) {
      $('barraEvento').textContent = d.evento.nombre;
      document.title = 'Asistencia — ' + d.evento.nombre;
    }
    $('menuInfo').textContent = 'Dispositivo: ' + d.dispositivo + ' · ' +
      (d.rol === 'ADMIN' ? 'Administrador' : 'Operador');

    mostrarVista('vistaEscaner');
    actualizarEstado();
    clearInterval(st.intervalo);
    st.intervalo = setInterval(actualizarEstado, INTERVALO_ESTADO_MS);

    if (conGesto) iniciarCamara();
    else visor('Toca el botón para activar la cámara.', 'Activar cámara');
  }

  function salir(msg) {
    borrar(LS.sesion);
    st.sesion = null;
    clearInterval(st.intervalo);
    detenerCamara();
    cerrarResultado();
    $('procesando').hidden = true;
    $('modalMenu').hidden = true;
    $('modalCodigo').hidden = true;
    st.modal = false;
    mostrarVista('vistaIngreso');
    if (msg) mensaje('ingresoMensaje', 'info', msg);
  }

  /* ===== Jornada ===== */
  function actualizarEstado() {
    if (!st.sesion) return;
    api('estadoEscaner').then(function (d) {
      st.proxima = d.proxima;
      pintarJornada(d.jornada);
    }).catch(function (e) {
      if (e.codigo === 'SESION') salir(e.message);
    });
  }

  function pintarJornada(j) {
    st.jornada = j || null;
    var caja = $('jornada');
    if (j) {
      caja.className = 'jornada activa';
      $('jornadaTexto').textContent = j.etiqueta;
      $('jornadaSub').textContent = j.fecha + ' · ' + j.horaInicio + ' – ' + j.horaFin;
    } else {
      caja.className = 'jornada inactiva';
      $('jornadaTexto').textContent = 'No hay jornada activa';
      $('jornadaSub').textContent = st.proxima
        ? 'Próxima: ' + st.proxima.etiqueta + ' · ' + st.proxima.fecha + ' ' + st.proxima.horaInicio
        : '';
    }
  }

  /* ===== Cámara ===== */
  function textoErrorCamara(e) {
    var n = (e && e.name) || '';
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      return 'No hay permiso para usar la cámara. Actívalo en los ajustes del navegador para este sitio y toca "Reintentar". Mientras tanto puedes usar "Ingresar código".';
    }
    if (n === 'NotFoundError' || n === 'OverconstrainedError') {
      return 'No se encontró una cámara en este dispositivo. Usa "Ingresar código".';
    }
    if (n === 'NotReadableError') {
      return 'La cámara está siendo usada por otra aplicación. Ciérrala y toca "Reintentar".';
    }
    return 'No se pudo iniciar la cámara. Toca "Reintentar" o usa "Ingresar código".';
  }

  function iniciarCamara() {
    prepararAudio();
    if (st.camara) return;

    if (typeof jsQR !== 'function') {
      visor('No se pudo cargar el lector de QR. Revisa la conexión y recarga la página.', 'Recargar',
        function () { location.reload(); });
      return;
    }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      visor('Este navegador no permite usar la cámara. Usa "Ingresar código".', null);
      return;
    }

    visor('Activando cámara…', null);
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    }).then(function (s) {
      st.stream = s;
      var v = $('video');
      v.srcObject = s;
      return v.play();
    }).then(function () {
      st.camara = true;
      visor(null);
      mantenerPantalla();
      bucle();
    }).catch(function (e) {
      detenerCamara();
      visor(textoErrorCamara(e), 'Reintentar');
    });
  }

  function detenerCamara() {
    st.camara = false;
    if (st.stream) st.stream.getTracks().forEach(function (t) { t.stop(); });
    st.stream = null;
    $('video').srcObject = null;
    if (st.wake) { try { st.wake.release(); } catch (e) {} st.wake = null; }
  }

  function bucle() {
    if (!st.camara) return;
    var v = $('video');
    if (!st.ocupado && !st.modal && v.readyState >= 2 && v.videoWidth) {
      var esc = Math.min(1, 640 / v.videoWidth);
      var w = Math.round(v.videoWidth * esc);
      var h = Math.round(v.videoHeight * esc);
      if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
      ctx.drawImage(v, 0, 0, w, h);
      var c = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (c && c.data) leido(c.data);
    }
    setTimeout(function () { requestAnimationFrame(bucle); }, 110);
  }

  function mantenerPantalla() {
    try {
      if ('wakeLock' in navigator && !st.wake) {
        navigator.wakeLock.request('screen').then(function (w) {
          st.wake = w;
          w.addEventListener('release', function () { st.wake = null; });
        }).catch(function () {});
      }
    } catch (e) {}
  }

  /* ===== Escaneo y resultado ===== */
  function leido(texto) {
    var ahora = Date.now();
    if (texto === st.ultimo && ahora - st.ultimoT < PAUSA_MISMO_QR_MS) return;
    st.ultimo = texto;
    st.ultimoT = ahora;

    if (texto.indexOf(PREFIJO_QR) !== 0) {
      resultado({ estado: 'QR_AJENO' }); // se descarta sin consultar al servidor
      return;
    }
    procesar({ qr: texto });
  }

  function procesar(datos) {
    if (st.ocupado) return;
    st.ocupado = true;
    $('procesando').hidden = false;

    api(ACCION_ESCANEO, datos).then(function (r) {
      $('procesando').hidden = true;
      if (Object.prototype.hasOwnProperty.call(r, 'jornada')) pintarJornada(r.jornada);
      if (r.estado === 'REGISTRADO') sumarContador();
      resultado(r);
    }).catch(function (e) {
      $('procesando').hidden = true;
      if (e.codigo === 'SESION') { st.ocupado = false; salir(e.message); return; }
      resultado({ estado: 'ERROR', mensaje: e.message });
    });
  }

  function resultado(r) {
    var v = VISUAL[r.estado] || VISUAL.ERROR;
    st.ocupado = true;

    var caja = $('resultado');
    caja.className = 'resultado ' + v.clase;
    $('resIcono').textContent = v.icono;
    $('resTitulo').textContent = v.titulo;
    $('resNombre').textContent = r.participante ? String(r.participante.nombre).toUpperCase() : '';

    var detalle = r.mensaje || v.detalle || '';
    if ((r.estado === 'REGISTRADO' || r.estado === 'VALIDO') && r.jornada) {
      detalle = r.jornada.etiqueta + (v.detalle ? '\n' + v.detalle : '');
    }
    $('resDetalle').textContent = detalle;

    var hora = r.hora || '';
    if (r.estado === 'YA_REGISTRADO' && r.horaRegistro) hora = 'Registró a las ' + r.horaRegistro;
    if (r.estado === 'NO_ENCONTRADO' || r.estado === 'QR_AJENO' || r.estado === 'ERROR') hora = '';
    $('resHora').textContent = hora;

    caja.hidden = false;
    sonar(v.sonido);
    clearTimeout(st.timerResultado);
    st.timerResultado = setTimeout(cerrarResultado, v.tiempo);
  }

  function cerrarResultado() {
    clearTimeout(st.timerResultado);
    $('resultado').hidden = true;
    st.ocupado = false;
    st.ultimoT = Date.now();
  }

  /* ===== Ingreso manual de código ===== */
  function abrirCodigo() {
    st.modal = true;
    $('inCodigo').value = '';
    mensaje('codigoMensaje');
    $('modalCodigo').hidden = false;
    setTimeout(function () { $('inCodigo').focus(); }, 60);
  }

  function cerrarCodigo() {
    st.modal = false;
    $('modalCodigo').hidden = true;
    $('inCodigo').blur();
  }

  function enviarCodigo() {
    var c = $('inCodigo').value.replace(/\D/g, '');
    if (c.length !== 6) {
      mensaje('codigoMensaje', 'error', 'El código debe tener 6 dígitos.');
      return;
    }
    prepararAudio();
    cerrarCodigo();
    procesar({ codigo: c });
  }

  /* ===== Menú ===== */
  function abrirMenu() { st.modal = true; $('modalMenu').hidden = false; }
  function cerrarMenu() { st.modal = false; $('modalMenu').hidden = true; }

  /* ===== Sonido y vibración ===== */
  function prepararAudio() {
    try {
      if (!st.audio) {
        var C = window.AudioContext || window.webkitAudioContext;
        if (C) st.audio = new C();
      }
      if (st.audio && st.audio.state === 'suspended') st.audio.resume();
    } catch (e) { st.audio = null; }
  }

  function tono(frec, inicio, dur, forma, vol) {
    var a = st.audio;
    var o = a.createOscillator();
    var g = a.createGain();
    var t = a.currentTime + inicio;
    o.type = forma || 'sine';
    o.frequency.value = frec;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function sonar(tipo) {
    if (st.sonido && st.audio) {
      try {
        if (tipo === 'exito') { tono(988, 0, 0.09); tono(1319, 0.1, 0.14); }
        else if (tipo === 'aviso') { tono(740, 0, 0.12, 'triangle'); tono(740, 0.18, 0.12, 'triangle'); }
        else { tono(196, 0, 0.35, 'square', 0.12); }
      } catch (e) {}
    }
    if (navigator.vibrate) {
      try { navigator.vibrate(tipo === 'exito' ? 70 : tipo === 'aviso' ? [70, 60, 70] : [220]); } catch (e) {}
    }
  }

  function pintarSonido() {
    $('btnSonido').textContent = st.sonido ? '🔊 Sonido' : '🔇 Sin sonido';
  }

  /* ===== Contador del día ===== */
  function hoy() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function leerContador() {
    try {
      var c = JSON.parse(leer(LS.contador) || '{}');
      return c.f === hoy() ? (c.n || 0) : 0;
    } catch (e) { return 0; }
  }
  function sumarContador() {
    guardar(LS.contador, JSON.stringify({ f: hoy(), n: leerContador() + 1 }));
    pintarContador();
  }
  function pintarContador() {
    var n = leerContador();
    $('contador').textContent = n + (n === 1 ? ' registro' : ' registros') + ' hoy en este dispositivo';
  }

  /* ===== Eventos ===== */
  function enlazarEventos() {
    $('btnIngresar').addEventListener('click', ingresar);
    $('inPin').addEventListener('keydown', function (e) { if (e.key === 'Enter') ingresar(); });

    $('btnCamara').addEventListener('click', function () {
      if (st.accionVisor) st.accionVisor(); else iniciarCamara();
    });

    $('btnCodigo').addEventListener('click', abrirCodigo);
    $('btnCodigoCancelar').addEventListener('click', cerrarCodigo);
    $('btnCodigoEnviar').addEventListener('click', enviarCodigo);
    $('inCodigo').addEventListener('keydown', function (e) { if (e.key === 'Enter') enviarCodigo(); });
    $('inCodigo').addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 6);
    });

    $('btnMenu').addEventListener('click', abrirMenu);
    $('btnMenuCerrar').addEventListener('click', cerrarMenu);
    $('btnActualizar').addEventListener('click', function () { actualizarEstado(); cerrarMenu(); });
    $('btnSalir').addEventListener('click', function () {
      if (confirm('¿Cerrar la sesión en este dispositivo?')) { cerrarMenu(); salir('Sesión cerrada.'); }
    });

    $('btnSonido').addEventListener('click', function () {
      st.sonido = !st.sonido;
      guardar(LS.sonido, st.sonido ? 'si' : 'no');
      prepararAudio();
      pintarSonido();
      if (st.sonido) sonar('exito');
    });

    $('resultado').addEventListener('click', cerrarResultado);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (st.camara) { st.reanudar = true; detenerCamara(); }
      } else if (st.reanudar && !$('vistaEscaner').hidden) {
        st.reanudar = false;
        iniciarCamara();
        actualizarEstado();
      }
    });
  }

  iniciar();
})();
