/* 向量共用：回報結果（postMessage 給 harness，同時存在 window.__vectorResults 供直接開啟時讀取）。 */
(function () {
  var results = (window.__vectorResults = []);
  function report(name, data) {
    results.push({ name: name, data: data });
    try {
      parent.postMessage({ __vector: true, name: name, data: data }, '*');
    } catch (e) {
      /* ignore */
    }
  }
  window.report = report;
  window.errName = function (e) {
    return e && e.name ? String(e.name) : String(e);
  };
  /*
   * 在「沒有 agent」的子 frame（srcdoc）裡執行程式碼，用來觀察瀏覽器／sandbox 的原生行為。
   * 子 frame 繼承 CSP 與 sandbox 旗標（所以是另一個 opaque origin），結果用 postMessage 回傳。
   */
  window.runInChild = function (code, cb) {
    var f = document.createElement('iframe');
    var done = false;
    function finish(out) {
      if (done) return;
      done = true;
      cb(out);
    }
    window.addEventListener('message', function (e) {
      if (e.source === f.contentWindow && e.data && e.data.__child) finish(e.data.out);
    });
    f.setAttribute(
      'srcdoc',
      '<!doctype html><body><script>var out = {};' + code + ';parent.postMessage({ __child: true, out: out }, "*");</' + 'script>'
    );
    document.body.appendChild(f);
    setTimeout(function () { finish({ timeout: true }); }, 3000);
  };
  document.addEventListener('securitypolicyviolation', function (e) {
    report('csp', {
      directive: e.effectiveDirective || e.violatedDirective,
      blocked: e.blockedURI,
    });
  });
})();
