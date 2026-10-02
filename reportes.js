/* ============================================================
 *  Control de Asistencia — reportes.js
 *  Pestañas Credenciales y Reportes del panel
 * ============================================================ */
(function () {
  'use strict';

  var A = window.Asistencia;
  if (!A) return;
  var $ = A.$;
  var esc = A.esc;

  var st = { reporte: null, parametros: null, jornadasCargadas: false, ocupado: false };

  /* ============ Utilidades ============ */

  function cargandoHtml(texto) {
    return '<div class="cargando"><div class="spinner"></div><p>' + esc(texto) + '</p></div>';
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
    if (e && e.codigo === 'SESION') {
      if (A.panel) A.panel.detener();
      A.salir(e.message);
      return;
    }
    toast((e && e.message) || 'Ocurrió un error. Intenta de nuevo.', 'error');
  }

  function confirmar(titulo, texto, etiqueta) {
    return new Promise(function (resolver) {
      var si = $('confAceptar');
      var no = $('confCancelar');
      $('confTitulo').textContent = titulo;
      $('confTexto').textContent = texto;
      si.textContent = etiqueta || 'Aceptar';
      si.className = 'btn btn-primario';
      $('modalConfirmar').hidden = false;
      function fin(v) {
        $('modalConfirmar').hidden = true;
        si.onclick = null;
        no.onclick = null;
        resolver(v);
      }
      si.onclick = function () { fin(true); };
      no.onclick = function () { fin(false); };
    });
  }

  /* ============ CREDENCIALES ============ */

  function modoCredenciales() {
    var r = document.querySelector('input[name="credModo"]:checked');
    return r ? r.value : 'activos';
  }

  function cambiarModoCredenciales() {
    $('credIds').hidden = modoCredenciales() !== 'ids';
  }

  function abrirImpresion() {
    var modo = modoCredenciales();
    var hash = 'modo=' + modo;
    if (modo === 'ids') {
      var ids = $('credIds').value.trim();
      if (!ids) { toast('Escribe al menos un ID, por ejemplo EVT-012.', 'error'); return; }
      hash += '&ids=' + encodeURIComponent(ids);
    }
    var ventana = window.open('credenciales.html#' + hash, '_blank');
    if (!ventana) toast('El navegador bloqueó la pestaña nueva. Permite ventanas emergentes para este sitio.', 'error');
  }

  /* ============ REPORTES ============ */

  function cambiarTipo() {
    var t = $('repTipo').value;
    $('repCampoJornada').hidden = t !== 'jornada';
    $('repCampoId').hidden = t !== 'individual';
    if (t === 'jornada') cargarJornadas();
    $('repResultado').innerHTML = '';
    st.reporte = null;
  }

  function cargarJornadas() {
    if (st.jornadasCargadas) return;
    $('repJornada').innerHTML = '<option value="">Cargando…</option>';
    A.api('adminJornadas').then(function (d) {
      $('repJornada').innerHTML = d.jornadas.map(function (j) {
        return '<option value="' + esc(j.id) + '">' + esc(j.etiqueta + ' · ' + j.fecha) + '</option>';
      }).join('');
      st.jornadasCargadas = true;
    }).catch(function (e) {
      $('repJornada').innerHTML = '';
      manejarError(e);
    });
  }

  function normalizarId(v) {
    var digitos = String(v || '').replace(/\D/g, '');
    if (!digitos) return '';
    var n = String(parseInt(digitos, 10));
    while (n.length < 3) n = '0' + n;
    return 'EVT-' + n;
  }

  function parametros() {
    var p = { tipo: $('repTipo').value };
    if (p.tipo === 'jornada') {
      p.jornada = $('repJornada').value;
      if (!p.jornada) { toast('Selecciona una jornada.', 'error'); return null; }
    }
    if (p.tipo === 'individual') {
      p.id = normalizarId($('repId').value);
      if (!p.id) { toast('Escribe un ID válido, por ejemplo EVT-012 o 12.', 'error'); return null; }
    }
    return p;
  }

  function generar() {
    var p = parametros();
    if (!p || st.ocupado) return;
    st.ocupado = true;
    $('repResultado').innerHTML = cargandoHtml('Generando reporte…');

    A.api('reporte', p).then(function (r) {
      st.reporte = r;
      st.parametros = p;
      pintarReporte(r);
    }).catch(function (e) {
      $('repResultado').innerHTML = '';
      manejarError(e);
    }).then(function () { st.ocupado = false; });
  }

  function textoCelda(v) {
    return typeof v === 'number' ? String(v).replace('.', ',') : String(v == null ? '' : v);
  }

  function pintarReporte(r) {
    var h = ['<section class="bloque">',
      '<h3>' + esc(r.titulo) + '</h3>',
      '<p class="nota">' + esc(r.filas.length) + ' fila(s) · generado a las ' + esc(r.generado) + '</p>'];

    if (r.filas.length) {
      h.push('<div class="tabla-envoltura"><table class="tabla"><thead><tr>');
      r.columnas.forEach(function (c) { h.push('<th>' + esc(c) + '</th>'); });
      h.push('</tr></thead><tbody>');
      r.filas.slice(0, 25).forEach(function (f) {
        h.push('<tr>' + f.map(function (v) { return '<td>' + esc(textoCelda(v)) + '</td>'; }).join('') + '</tr>');
      });
      h.push('</tbody></table></div>');
      if (r.filas.length > 25) {
        h.push('<p class="nota">Vista previa de las primeras 25 filas. El archivo incluye todas.</p>');
      }
    } else {
      h.push('<p class="vacio">No hay datos para este reporte.</p>');
    }

    var desactivado = r.filas.length ? '' : ' disabled';
    h.push('<div class="rep-botones">' +
      '<button id="btnRepCsv" class="btn btn-primario"' + desactivado + '>Descargar CSV (Excel)</button>' +
      '<button id="btnRepHoja" class="btn btn-secundario"' + desactivado + '>Guardar en Google Sheets</button>' +
      '</div><div id="repEnlaceHoja"></div></section>');

    $('repResultado').innerHTML = h.join('');
    $('btnRepCsv').onclick = descargarCsv;
    $('btnRepHoja').onclick = guardarHoja;
  }

  /** Celda CSV segura: separador ";" (Excel en español) y sin fórmulas. */
  function celdaCsv(v) {
    var s = textoCelda(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    if (/[;"\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function descargarCsv() {
    var r = st.reporte;
    if (!r) return;
    var lineas = [r.columnas.map(celdaCsv).join(';')];
    r.filas.forEach(function (f) { lineas.push(f.map(celdaCsv).join(';')); });

    var blob = new Blob(['\uFEFF' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = r.archivo + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    toast('Archivo descargado: ' + r.archivo + '.csv');
  }

  function guardarHoja() {
    if (!st.reporte || st.ocupado) return;
    confirmar('¿Guardar en Google Sheets?',
      'Se creará una pestaña nueva con este reporte en la hoja de cálculo del sistema. No se modifica ninguna pestaña existente.',
      'Guardar').then(function (si) {
      if (!si) return;
      st.ocupado = true;
      var b = $('btnRepHoja');
      b.disabled = true;
      b.textContent = 'Guardando…';

      A.api('guardarReporte', st.parametros).then(function (r) {
        toast('Guardado en la pestaña "' + r.hoja + '".');
        $('repEnlaceHoja').innerHTML = '<a class="btn btn-secundario btn-bloque enlace-boton" href="' +
          esc(r.url) + '" target="_blank" rel="noopener">Abrir la hoja ↗</a>';
        b.textContent = 'Guardado ✓';
      }).catch(function (e) {
        b.disabled = false;
        b.textContent = 'Guardar en Google Sheets';
        manejarError(e);
      }).then(function () { st.ocupado = false; });
    });
  }

  /* ============ Eventos ============ */

  Array.prototype.forEach.call(document.querySelectorAll('input[name="credModo"]'), function (r) {
    r.addEventListener('change', cambiarModoCredenciales);
  });
  $('btnCredAbrir').addEventListener('click', abrirImpresion);
  $('repTipo').addEventListener('change', cambiarTipo);
  $('btnRepGenerar').addEventListener('click', generar);
  $('repId').addEventListener('keydown', function (e) { if (e.key === 'Enter') generar(); });
})();
