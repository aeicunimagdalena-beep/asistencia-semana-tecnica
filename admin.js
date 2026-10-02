/* ============================================================
 *  Control de Asistencia — admin.js
 *  Panel de administración: Resumen, Jornadas y Buscar
 * ============================================================ */
(function () {
  'use strict';

  var A = window.Asistencia;
  if (!A) return;
  var $ = A.$;
  var esc = A.esc;

  var REFRESCO_MS = 15000;
  var st = {
    timer: null,
    pestana: 'resumen',
    cargandoResumen: false,
    hayResumen: false,
    jornadas: null,
    detalle: null,
    ultimaBusqueda: null,
    ocupado: false
  };

  /* ============ Utilidades ============ */

  function cargandoHtml(texto) {
    return '<div class="cargando"><div class="spinner"></div><p>' + esc(texto) + '</p></div>';
  }

  function pct(n) {
    return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',') + ' %';
  }

  var timerToast = null;
  function toast(texto, tipo) {
    var el = $('panelToast');
    el.textContent = texto;
    el.className = 'toast ' + (tipo || 'exito');
    el.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(function () { el.hidden = true; }, tipo === 'error' ? 6000 : 3500);
  }

  function manejarError(e) {
    if (e && e.codigo === 'SESION') { detener(); cerrarDetalle(); A.salir(e.message); return; }
    toast((e && e.message) || 'Ocurrió un error. Intenta de nuevo.', 'error');
  }

  function confirmar(titulo, texto, etiqueta, peligro) {
    return new Promise(function (resolver) {
      var si = $('confAceptar');
      var no = $('confCancelar');
      $('confTitulo').textContent = titulo;
      $('confTexto').textContent = texto;
      si.textContent = etiqueta || 'Aceptar';
      si.className = 'btn ' + (peligro ? 'btn-peligro-lleno' : 'btn-primario');
      $('modalConfirmar').hidden = false;
      function fin(valor) {
        $('modalConfirmar').hidden = true;
        si.onclick = null;
        no.onclick = null;
        resolver(valor);
      }
      si.onclick = function () { fin(true); };
      no.onclick = function () { fin(false); };
    });
  }

  function chipParticipante(estado) {
    if (estado === 'ACTIVO') return '<span class="chip chip-exito">ACTIVO</span>';
    if (estado === 'ANULADO') return '<span class="chip chip-gris">ANULADO</span>';
    return '<span class="chip chip-aviso">PAGO PENDIENTE</span>';
  }

  /* ============ Abrir / cerrar panel y pestañas ============ */

  function abrir() {
    if (A.rol() !== 'ADMIN') return;
    A.pausarEscaner();
    A.mostrarVista('vistaPanel');
    cambiarPestana(st.pestana);
    clearInterval(st.timer);
    st.timer = setInterval(function () {
      if (st.pestana === 'resumen' && !document.hidden) cargarResumen();
    }, REFRESCO_MS);
  }

  function detener() {
    clearInterval(st.timer);
    st.timer = null;
  }

  function volver() {
    detener();
    cerrarDetalle();
    A.reanudarEscaner();
  }

  function cambiarPestana(p) {
    st.pestana = p;
    Array.prototype.forEach.call(document.querySelectorAll('.pestana'), function (b) {
      b.classList.toggle('activa', b.getAttribute('data-pestana') === p);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-seccion]'), function (s) {
      s.hidden = s.getAttribute('data-seccion') !== p;
    });
    avisoPanel('');
    if (p === 'resumen') cargarResumen();
    if (p === 'jornadas') cargarJornadas();
  }

  function actualizarPestana() {
    if (st.pestana === 'resumen') cargarResumen();
    else if (st.pestana === 'jornadas') cargarJornadas();
    else if (st.pestana === 'buscar' && st.ultimaBusqueda) buscar(st.ultimaBusqueda.filtro, true);
  }

  function avisoPanel(texto) {
    var el = $('panelAviso');
    el.hidden = !texto;
    el.textContent = texto || '';
  }

  /* ============ RESUMEN ============ */

  function cargarResumen() {
    if (st.cargandoResumen) return;
    st.cargandoResumen = true;
    if (!st.hayResumen) $('secResumen').innerHTML = cargandoHtml('Cargando resumen…');
    $('btnPanelActualizar').classList.add('girando');

    A.api('dashboard').then(function (d) {
      st.hayResumen = true;
      avisoPanel('');
      pintarResumen(d);
    }).catch(function (e) {
      if (e.codigo === 'SESION') { manejarError(e); return; }
      avisoPanel(e.message + ' Se reintentará automáticamente.');
    }).then(function () {
      st.cargandoResumen = false;
      $('btnPanelActualizar').classList.remove('girando');
    });
  }

  function kpi(titulo, valor, sub, clase) {
    return '<div class="kpi ' + (clase || '') + '">' +
      '<div class="kpi-valor">' + esc(valor) + '</div>' +
      '<div class="kpi-titulo">' + esc(titulo) + '</div>' +
      (sub ? '<div class="kpi-sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  function chipJornada(estado) {
    var clase = { 'EN CURSO': 'chip-exito', 'FINALIZADA': 'chip-gris', 'CERRADA': 'chip-gris', 'PRÓXIMA': 'chip-info' }[estado] || 'chip-gris';
    return '<span class="chip ' + clase + '">' + esc(estado) + '</span>';
  }

  function pintarResumen(d) {
    var h = [];
    var a = d.actual;

    if (d.jornadaActual) {
      h.push('<div class="tarjeta-jornada activa">' +
        '<div class="tj-etq">Jornada en curso</div>' +
        '<div class="tj-valor">' + esc(d.jornadaActual.etiqueta) + '</div>' +
        '<div class="tj-sub">' + esc(d.jornadaActual.fecha + ' · ' + d.jornadaActual.horaInicio + ' – ' + d.jornadaActual.horaFin) + '</div>' +
        '</div>');
    } else {
      h.push('<div class="tarjeta-jornada inactiva">' +
        '<div class="tj-etq">Jornada en curso</div>' +
        '<div class="tj-valor">No hay jornada activa</div>' +
        '</div>');
    }

    h.push('<div class="kpis">' +
      kpi('Inscritos', d.totales.activos, 'con pago verificado') +
      kpi('Asistencia actual', a ? a.presentes : '—', a ? 'en esta jornada' : 'sin jornada activa', 'kpi-exito') +
      kpi('Porcentaje', a ? pct(a.porcentaje) : '—', a ? 'de los inscritos' : '', 'kpi-info') +
      kpi('Pendientes', a ? a.faltan : '—', a ? 'aún no ingresan' : '', 'kpi-aviso') +
      '</div>');

    h.push('<p class="nota">Pago pendiente: <b>' + esc(d.totales.pendientesPago) + '</b> · ' +
      'Anulados: <b>' + esc(d.totales.anulados) + '</b> · ' +
      'Total en el sistema: <b>' + esc(d.totales.total) + '</b></p>');

    h.push('<section class="bloque"><h3>Asistencia por jornada</h3>');
    d.jornadas.forEach(function (j) {
      h.push('<div class="fila-jornada' + (j.estado === 'EN CURSO' ? ' en-curso' : '') + '">' +
        '<div class="fj-cab"><span class="fj-nombre">' + esc(j.etiqueta) + '</span>' + chipJornada(j.estado) + '</div>' +
        '<div class="fj-barra"><div class="fj-relleno" style="width:' + Math.min(100, j.porcentaje) + '%"></div></div>' +
        '<div class="fj-pie"><span>' + esc(j.presentes) + ' / ' + esc(d.totales.activos) + '</span>' +
        '<span>' + pct(j.porcentaje) + '</span></div>' +
        '</div>');
    });
    h.push('</section>');

    if (a) {
      h.push('<section class="bloque"><h3>Registros por dispositivo · jornada actual</h3>');
      if (d.dispositivos.length) {
        h.push('<ul class="lista">');
        d.dispositivos.forEach(function (x) {
          h.push('<li><span>' + esc(x.nombre) + '</span><b>' + esc(x.registros) + '</b></li>');
        });
        h.push('</ul>');
      } else {
        h.push('<p class="vacio">Aún no hay registros en esta jornada.</p>');
      }
      h.push('</section>');
    }

    h.push('<section class="bloque"><h3>Últimos registros</h3>');
    if (d.ultimos.length) {
      h.push('<ul class="lista lista-registros">');
      d.ultimos.forEach(function (u) {
        h.push('<li>' +
          '<div class="lr-hora">' + esc(u.hora) + '<span>' + esc(u.fecha) + '</span></div>' +
          '<div class="lr-datos"><div class="lr-nombre">' + esc(u.nombre) + '</div>' +
          '<div class="lr-sub">' + esc(u.id + ' · ' + u.jornada + ' · ' + u.metodo + ' · ' + u.dispositivo) + '</div></div>' +
          '</li>');
      });
      h.push('</ul>');
    } else {
      h.push('<p class="vacio">Todavía no hay registros de asistencia.</p>');
    }
    h.push('</section>');

    h.push('<p class="actualizado">Actualizado a las ' + esc(d.generado) + ' · se actualiza cada 15 segundos</p>');
    $('secResumen').innerHTML = h.join('');
  }

  /* ============ JORNADAS ============ */

  function cargarJornadas() {
    $('secJornadas').innerHTML = cargandoHtml('Cargando jornadas…');
    A.api('adminJornadas').then(pintarJornadas).catch(function (e) {
      $('secJornadas').innerHTML = '';
      manejarError(e);
    });
  }

  function pintarJornadas(d) {
    st.jornadas = d;
    var manual = d.modo === 'MANUAL';
    var h = [];

    h.push('<div class="tarjeta-modo ' + (manual ? 'manual' : 'auto') + '">' +
      '<div class="tm-etq">Modo de jornadas</div>' +
      '<div class="tm-valor">' + (manual ? 'MANUAL' : 'AUTOMÁTICO') + '</div>' +
      '<div class="tm-sub">' + (manual
        ? 'La jornada activa la decide el administrador.'
        : 'La jornada cambia sola según los horarios (' + esc(d.margen) + ' min de anticipación).') + '</div>' +
      (manual ? '<button class="btn btn-secundario btn-bloque" data-op="automatico">Volver a modo automático</button>' : '') +
      '</div>');

    d.jornadas.forEach(function (j) {
      var chip;
      if (j.enCurso) chip = '<span class="chip chip-exito">EN CURSO</span>';
      else if (j.estado === 'CERRADA') chip = '<span class="chip chip-gris">CERRADA</span>';
      else if (j.estado === 'ACTIVA') chip = '<span class="chip chip-exito">ACTIVA</span>';
      else chip = '<span class="chip chip-info">PENDIENTE</span>';

      var botones = [];
      if (!j.enCurso && j.estado !== 'CERRADA') {
        botones.push('<button class="btn btn-primario" data-op="activar" data-id="' + esc(j.id) + '">Activar</button>');
      }
      if (j.estado !== 'CERRADA') {
        botones.push('<button class="btn btn-peligro" data-op="cerrar" data-id="' + esc(j.id) + '">Cerrar</button>');
      } else {
        botones.push('<button class="btn btn-secundario" data-op="reabrir" data-id="' + esc(j.id) + '">Reabrir</button>');
      }

      h.push('<div class="jornada-admin' + (j.enCurso ? ' en-curso' : '') + '">' +
        '<div class="ja-cab"><div>' +
        '<div class="ja-nombre">' + esc(j.etiqueta) + '</div>' +
        '<div class="ja-sub">' + esc(j.fecha + ' · ' + j.horaInicio + ' – ' + j.horaFin) + '</div>' +
        '</div>' + chip + '</div>' +
        '<div class="ja-botones">' + botones.join('') + '</div>' +
        '</div>');
    });

    h.push('<p class="nota">Los escáneres toman los cambios en máximo 30 segundos. ' +
      'Las fechas y horarios se editan en la hoja JORNADAS.</p>');
    $('secJornadas').innerHTML = h.join('');
  }

  function clicJornadas(ev) {
    var b = ev.target.closest('button[data-op]');
    if (!b || st.ocupado || !st.jornadas) return;
    var op = b.getAttribute('data-op');
    var id = b.getAttribute('data-id');
    var j = null;
    st.jornadas.jornadas.forEach(function (x) { if (x.id === id) j = x; });
    var et = j ? j.etiqueta : '';

    var textos = {
      activar: ['¿Deseas activar ' + et + '?',
        'La jornada actual dejará de recibir registros y todos los escáneres pasarán a ' + et +
        '. El sistema quedará en modo MANUAL hasta que vuelvas al automático.', 'Activar', false],
      cerrar: ['¿Cerrar ' + et + '?',
        'No se podrán registrar más asistencias en esta jornada. Puedes reabrirla después.', 'Cerrar jornada', true],
      reabrir: ['¿Reabrir ' + et + '?',
        'La jornada volverá a estar disponible según el modo actual.', 'Reabrir', false],
      automatico: ['¿Volver al modo automático?',
        'Las jornadas cambiarán solas según los horarios de la hoja JORNADAS.', 'Volver a automático', false]
    }[op];
    if (!textos) return;

    confirmar(textos[0], textos[1], textos[2], textos[3]).then(function (si) {
      if (!si) return;
      st.ocupado = true;
      b.disabled = true;
      A.api('accionJornada', { operacion: op, id: id }).then(function (d) {
        pintarJornadas(d);
        toast('Listo. Los escáneres se actualizarán en máximo 30 segundos.');
      }).catch(function (e) {
        b.disabled = false;
        manejarError(e);
      }).then(function () { st.ocupado = false; });
    });
  }

  /* ============ BUSCAR ============ */

  function buscar(filtro, silencioso) {
    var q = $('inBuscar').value.trim();
    if (!filtro && q.length < 2) {
      if (!silencioso) toast('Escribe al menos 2 caracteres para buscar.', 'error');
      return;
    }
    st.ultimaBusqueda = { q: q, filtro: filtro || '' };
    $('resultadosBusqueda').innerHTML = cargandoHtml('Buscando…');
    $('inBuscar').blur();

    A.api('buscar', { q: q, filtro: filtro || '' }).then(pintarResultados).catch(function (e) {
      $('resultadosBusqueda').innerHTML = '';
      manejarError(e);
    });
  }

  function pintarResultados(d) {
    if (!d.resultados.length) {
      $('resultadosBusqueda').innerHTML = '<p class="vacio">No se encontraron participantes.</p>';
      return;
    }
    var h = ['<p class="nota">' + esc(d.total) + ' resultado(s)' +
      (d.total > d.resultados.length ? ' · se muestran los primeros ' + d.resultados.length : '') + '</p>',
      '<ul class="lista lista-busqueda">'];
    d.resultados.forEach(function (p) {
      h.push('<li><button class="item-busqueda" data-id="' + esc(p.id) + '">' +
        '<div class="ib-datos"><div class="ib-nombre">' + esc(p.nombre) + '</div>' +
        '<div class="ib-sub">' + esc(p.id + ' · ' + p.correo) + '</div></div>' +
        chipParticipante(p.estado) +
        '</button></li>');
    });
    h.push('</ul>');
    $('resultadosBusqueda').innerHTML = h.join('');
  }

  /* ============ FICHA DEL PARTICIPANTE ============ */

  function abrirDetalle(id) {
    st.detalle = null;
    $('detalleContenido').innerHTML = cargandoHtml('Cargando…');
    $('modalDetalle').hidden = false;
    A.api('detalle', { id: id }).then(pintarDetalle).catch(function (e) {
      cerrarDetalle();
      manejarError(e);
    });
  }

  function cerrarDetalle() {
    $('modalDetalle').hidden = true;
    st.detalle = null;
  }

  function dato(etiqueta, valor) {
    return '<div><dt>' + esc(etiqueta) + '</dt><dd>' + esc(valor || '—') + '</dd></div>';
  }

  function pintarDetalle(d) {
    st.detalle = d;
    var p = d.participante;
    var h = [];

    h.push('<div class="det-cab"><div>' +
      '<div class="det-nombre">' + esc(p.nombre) + '</div>' +
      '<div class="det-sub">' + esc(p.id) + '</div></div>' +
      chipParticipante(p.estado) + '</div>');

    h.push('<dl class="det-datos">' +
      dato('Código de asistencia', p.codigo) +
      dato('Correo', p.correo) +
      dato('Documento', p.documento) +
      dato('Perfil', p.perfil) +
      dato('Institución', p.institucion) +
      dato('Código estudiantil', p.codigoEstudiantil) +
      dato('Credencial por correo', p.estadoCorreo
        ? p.estadoCorreo + (p.fechaEnvio ? ' · ' + p.fechaEnvio : '')
        : 'No enviada') +
      '</dl>');

    if (/^https?:\/\//i.test(p.comprobante)) {
      h.push('<a class="btn btn-secundario btn-bloque enlace-boton" href="' + esc(p.comprobante) +
        '" target="_blank" rel="noopener">Ver comprobante de pago ↗</a>');
    }

    h.push('<h3 class="det-titulo">Asistencia · ' + esc(d.asistidas) + ' de ' + esc(d.total) +
      ' (' + pct(d.porcentaje) + ')</h3>');
    h.push('<ul class="lista lista-asistencia">');
    d.asistencia.forEach(function (a) {
      h.push('<li class="' + (a.asistio ? 'si' : 'no') + '">' +
        '<span class="as-marca">' + (a.asistio ? '✓' : '✗') + '</span>' +
        '<div class="as-datos"><div>' + esc(a.etiqueta) + '</div>' +
        (a.asistio ? '<div class="as-sub">' + esc(a.hora + ' · ' + a.metodo + ' · ' + a.dispositivo) + '</div>' : '') +
        '</div></li>');
    });
    h.push('</ul>');

    h.push('<div class="det-acciones">');
    if (p.estado === 'ACTIVO' && d.jornadaActual && !d.registradoEnActual) {
      h.push('<button class="btn btn-primario btn-bloque" data-acc="registrar">Registrar asistencia · ' +
        esc(d.jornadaActual.etiqueta) + '</button>');
    }
    if (p.estado === 'PAGO PENDIENTE') {
      h.push('<button class="btn btn-primario btn-bloque" data-acc="pago">Verificar pago y enviar credencial</button>');
    }
    if (p.estado === 'ACTIVO') {
      h.push('<button class="btn btn-secundario btn-bloque" data-acc="reenviar">Reenviar credencial por correo</button>');
    }
    if (p.estado !== 'ANULADO') {
      h.push('<button class="btn btn-peligro btn-bloque" data-acc="regenerar">Generar nuevo QR y código</button>');
    }
    h.push('</div>');

    $('detalleContenido').innerHTML = h.join('');
  }

  function clicDetalle(ev) {
    var b = ev.target.closest('button[data-acc]');
    if (!b || st.ocupado || !st.detalle) return;
    var acc = b.getAttribute('data-acc');
    var p = st.detalle.participante;
    var jo = st.detalle.jornadaActual;

    var cfg = {
      registrar: ['¿Registrar asistencia?',
        p.nombre + ' quedará registrado(a) en ' + (jo ? jo.etiqueta : 'la jornada actual') + ' (método: búsqueda manual).',
        'Registrar', false, 'registrarManual'],
      pago: ['¿Verificar el pago?',
        'Confirma que revisaste el comprobante de ' + p.nombre + '. Quedará ACTIVO y recibirá su credencial por correo.',
        'Verificar pago', false, 'verificarPago'],
      reenviar: ['¿Reenviar la credencial?',
        'Se enviará de nuevo el correo con el código QR a ' + p.correo + '.',
        'Reenviar', false, 'reenviarCredencial'],
      regenerar: ['¿Generar un nuevo QR?',
        'El QR y el código actuales de ' + p.nombre + ' dejarán de funcionar. Úsalo solo si la credencial se perdió o la está usando otra persona.' +
        (p.estado === 'ACTIVO' ? ' La nueva credencial se enviará por correo.' : ''),
        'Generar nuevo QR', true, 'regenerarCredencial']
    }[acc];
    if (!cfg) return;

    confirmar(cfg[0], cfg[1], cfg[2], cfg[3]).then(function (si) {
      if (!si) return;
      st.ocupado = true;
      var texto = b.textContent;
      b.disabled = true;
      b.textContent = 'Procesando…';

      A.api(cfg[4], { id: p.id }).then(function (r) {
        if (acc === 'registrar') {
          pintarDetalle(r.detalle);
          var e = r.resultado.estado;
          if (e === 'REGISTRADO') toast('Asistencia registrada.');
          else if (e === 'YA_REGISTRADO') toast('Ya estaba registrado(a) en esta jornada.', 'error');
          else if (e === 'SIN_JORNADA') toast('No hay jornada activa en este momento.', 'error');
          else toast('No se registró (' + e + ').', 'error');
        } else {
          pintarDetalle(r);
          if (acc === 'pago') {
            toast(r.participante.estadoCorreo === 'ENVIADO'
              ? 'Pago verificado. Credencial enviada por correo.'
              : 'Pago verificado. El correo quedó pendiente y se enviará automáticamente.');
          } else if (acc === 'reenviar') {
            toast('Credencial reenviada.');
          } else {
            toast(r.correoNuevo === 'enviado' ? 'Nuevo QR generado y enviado por correo.' : 'Nuevo QR generado.');
          }
        }
      }).catch(function (e) {
        b.disabled = false;
        b.textContent = texto;
        manejarError(e);
      }).then(function () { st.ocupado = false; });
    });
  }

  /* ============ Eventos ============ */

  Array.prototype.forEach.call(document.querySelectorAll('.pestana'), function (b) {
    b.addEventListener('click', function () { cambiarPestana(b.getAttribute('data-pestana')); });
  });
  $('btnVolverEscaner').addEventListener('click', volver);
  $('btnPanelActualizar').addEventListener('click', actualizarPestana);
  $('secJornadas').addEventListener('click', clicJornadas);
  $('btnBuscar').addEventListener('click', function () { buscar(''); });
  $('inBuscar').addEventListener('keydown', function (e) { if (e.key === 'Enter') buscar(''); });
  $('btnPendientes').addEventListener('click', function () { buscar('pendientes'); });
  $('resultadosBusqueda').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-id]');
    if (b) abrirDetalle(b.getAttribute('data-id'));
  });
  $('detalleContenido').addEventListener('click', clicDetalle);
  $('btnDetalleCerrar').addEventListener('click', cerrarDetalle);

  A.panel = { abrir: abrir, detener: detener };
})();
