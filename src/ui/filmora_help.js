/* 文字PVメーカー v2 — original work. 「Filmoraで使うには」: a help sheet with the numbered steps of the Filmora set's README, the uses of its other files and the files themselves, with the real names and settings (DESIGN_2_1 §13.9, §13.10). */
MV.def('ui/filmora_help', ['ui/dom', 'ui/output', 'export/schedule', 'export/host/kit'], (dom, OUT, S, KIT) => {
  'use strict';

  const { h } = dom;

  // Info = { files: [{ name, kind }], w, h, fps, folder: string | null, parent: string | null, zip: string | null }: what
  // the sheet talks about (parent: the name of the folder the user picked, when the browser gives it).

  // planned(doc, plan, env) → Info for the set the current settings would write (export/schedule.kitFiles, the names
  // before the export; env = { audioCodec, songReady } as for kitFiles). Where it goes is not known yet.
  function planned(doc, plan, env) {
    const { w, h: hh } = S.outputSize(plan.design.aspect, doc.output.short);
    return { files: S.kitFiles(doc, plan, env || {}).map((f) => ({ name: f.name, kind: f.kind })), w, h: hh,
      fps: doc.output.fps, folder: null, parent: null, zip: null };
  }

  // written(result, size) → Info for a set exportKit wrote: its files, and the folder they are in (inside the folder the
  // user picked, result.parent) — or the ZIP, when the browser could not write a folder (result.name). size = { w, h,
  // fps } of that export.
  function written(result, size) {
    const zip = result.name || null;
    return { files: result.files.map((f) => ({ name: f.name, kind: f.kind })), w: size.w, h: size.h, fps: size.fps,
      folder: zip ? null : result.folder || null, parent: zip ? null : result.parent || null, zip };
  }

  // guide(info, t) → { intro, steps: [text], align, extras: [{ kind, text }], key: '#00B140' | null, files: [{ name,
  // kind, label }], same } in t's language: where the files are (or that the export makes them); the README's numbered
  // steps and its uses of the other files (export/host/kit.steps and .extras: the same text as README_Filmora.txt); the
  // green screen's key colour when the set has one; every file with its name.
  function guide(info, t) {
    const where = info.parent ? t('kit.help.folderIn', { folder: info.folder, parent: info.parent })
      : t('kit.help.folder', { folder: info.folder });
    const intro = info.zip ? t('kit.help.zip', { zip: info.zip }) : info.folder ? where : t('kit.help.before');
    const files = info.files.map((f) => ({ name: f.name, kind: f.kind, label: OUT.kitLabel(f.kind) ? t(OUT.kitLabel(f.kind)) : '' }));
    return {
      intro, steps: KIT.steps(t, info.files, info), align: t('kit.help.align'), extras: KIT.extras(t, info.files),
      key: info.files.some((f) => f.kind === 'green') ? KIT.KEY_COLOUR : null, files, same: t('kit.help.same'),
    };
  }

  // open(app, info) → Promise: the sheet in a <dialog> (ui/dialogs, like the shortcut sheet): the steps first (what the
  // user came for, in view when it opens), then 「必要なときだけ」 with the key colour under the green screen's use,
  // then the files as a compact list. Esc, × or a click outside close it, and the focus goes back to where it was.
  function open(app, info) {
    const t = app.t;
    const g = guide(info, t);
    const keyLine = () => h('p', { class: 'kit-key' }, h('span', { class: 'kit-key-chip', 'aria-hidden': 'true' }),
      h('span', { text: t('kit.help.keyColour') + ': ' + g.key }));
    return app.dialogs.open((body) => {
      dom.replace(body,
        h('p', { class: 'dlg-text', text: g.intro }),
        h('h3', { class: 'dlg-sub', text: t('kit.help.stepsTitle') }),
        h('ol', { class: 'kit-steps' }, g.steps.map((s) => h('li', { text: s }))),
        h('p', { class: 'note kit-align', text: g.align }),
        g.extras.length ? [h('h3', { class: 'dlg-sub', text: t('kit.help.optional') }),
          h('ul', { class: 'kit-extras' }, g.extras.map((x) => h('li', { 'data-kind': x.kind },
            h('span', { text: x.text }), x.kind === 'green' && g.key ? keyLine() : null)))] : null,
        h('h3', { class: 'dlg-sub', text: t('kit.help.filesTitle') }),
        h('ul', { class: 'kit-help-files' }, g.files.map((f) => h('li', {},
          h('span', { class: 'kit-file-name', text: f.name }), f.label ? h('span', { class: 'kit-file-meta', text: f.label }) : null))),
        h('p', { class: 'note subtle', text: g.same }));
    }, { title: t('kit.help.title'), wide: true });
  }

  return { planned, written, guide, open };
});
