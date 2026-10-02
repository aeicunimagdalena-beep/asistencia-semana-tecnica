/* ============================================================
 *  Control de Asistencia — admin.js
 *  Panel de administración (Fase 7: Resumen)
 * ============================================================ */
(function () {
  'use strict';

  var A = window.Asistencia;
  if (!A) return;
  var $ = A.$;
  var esc = A.esc;

  var REFRESCO_MS = 15000;
  var timer = null;
  var cargando = false;
  var hayDatos = false;

  /* ===== Abrir / cerrar ===== */
  function abrir() {
    if (A.rol() !== 'ADMIN') return;
    A.pausarEscaner();
    A.mostrarVista('vistaPanel');
    if (!hayDatos) $('secResumen').innerHTML = '<div class="cargando"><div class="spinner"></div><p>Cargando resumen…</p></div>';
    cargarResumen();
    clearInterval(timer);
    timer = setInterval(cargarResumen, REFRESCO_MS);
  }

  function detener() {
    clearInterval(timer);
    timer = null;
  }

  function volver() {
    detener();
    A.reanudarEscaner();
  }

  /* ===== Resumen ===== */
  function cargarResumen() {
    if (cargando) return;
    cargando = true;
    $('btnPanelActualizar').classList.add('girando');
    A.api('dashboard').then(function (d) {
      hayDatos = true;
      avisoPanel('');
      pintarResumen(d);
    }).catch(function (e) {
      if (e.codigo === 'SESION') { detener(); A.salir(e.message); return; }
      if (e.codigo === 'PERMISO') { detener(); avisoPanel(e.message); return; }
      avisoPanel(e.message + ' Se reintentará automáticamente.');
    }).then(function () {
      cargando = false;
      $('btnPanelActualizar').classList.remove('girando');
    });
  }

  function avisoPanel(texto) {
    var el = $('panelAviso');
    el.hidden = !texto;
    el.textContent = texto || '';
  }

  function pct(n) {
    return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',') + ' %';
  }

  function kpi(titulo, valor, sub, clase) {
    return '<div class="kpi ' + (clase || '') + '">' +
      '<div class="kpi-valor">' + esc(valor) + '</div>' +
      '<div class="kpi-titulo">' + esc(titulo) + '</div>' +
      (sub ? '<div class="kpi-sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  function chipEstado(estado) {
    var clase = { 'EN CURSO': 'chip-exito', 'FINALIZADA': 'chip-gris', 'CERRADA': 'chip-gris', 'PRÓXIMA': 'chip-info' }[estado] || 'chip-gris';
    return '<span class="chip ' + clase + '">' + esc(estado) + '</span>';
  }

  function pintarResumen(d) {
    var h = [];
    var a = d.actual;

    // Jornada en curso
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

    // Indicadores principales
    h.push('<div class="kpis">' +
      kpi('Inscritos', d.totales.activos, 'con pago verificado') +
      kpi('Asistencia actual', a ? a.presentes : '—', a ? 'en esta jornada' : 'sin jornada activa', 'kpi-exito') +
      kpi('Porcentaje', a ? pct(a.porcentaje) : '—', a ? 'de los inscritos' : '', 'kpi-info') +
      kpi('Pendientes', a ? a.faltan : '—', a ? 'aún no ingresan' : '', 'kpi-aviso') +
      '</div>');

    h.push('<p class="nota">Pago pendiente: <b>' + esc(d.totales.pendientesPago) + '</b> · ' +
      'Anulados: <b>' + esc(d.totales.anulados) + '</b> · ' +
      'Total en el sistema: <b>' + esc(d.totales.total) + '</b></p>');

    // Por jornada
    h.push('<section class="bloque"><h3>Asistencia por jornada</h3>');
    d.jornadas.forEach(function (j) {
      var ancho = Math.min(100, j.porcentaje);
      h.push('<div class="fila-jornada' + (j.estado === 'EN CURSO' ? ' en-curso' : '') + '">' +
        '<div class="fj-cab"><span class="fj-nombre">' + esc(j.etiqueta) + '</span>' + chipEstado(j.estado) + '</div>' +
        '<div class="fj-barra"><div class="fj-relleno" style="width:' + ancho + '%"></div></div>' +
        '<div class="fj-pie"><span>' + esc(j.presentes) + ' / ' + esc(d.totales.activos) + '</span>' +
        '<span>' + pct(j.porcentaje) + '</span></div>' +
        '</div>');
    });
    h.push('</section>');

    // Por dispositivo
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

    // Últimos registros
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

  /* ===== Eventos ===== */
  $('btnVolverEscaner').addEventListener('click', volver);
  $('btnPanelActualizar').addEventListener('click', cargarResumen);

  A.panel = { abrir: abrir, detener: detener };
})();
