/* ─────────────────────────────────────────────────────────────
   Nova — shrink a profile picture in the browser before upload

   A phone photo is several megabytes; a profile picture needs a few
   hundred pixels. This crops the chosen image to a square, scales it
   to 256px and swaps the shrunk file into the form, so the upload is
   small and the person never sees a "too large" error for an ordinary
   photo.

   PRESENTATION ONLY. The server does not trust any of it: it reads
   the uploaded bytes itself, checks they are a real PNG, JPEG or WebP
   under the size limit, and refuses anything else, whether or not this
   script ran. If anything here fails, the original file is uploaded
   as chosen and the server decides.
   ───────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  var input = document.querySelector("[data-avatar-input]");
  if (!input || !window.DataTransfer || !window.File || !HTMLCanvasElement.prototype.toBlob) return;

  var SIZE = 256;

  input.addEventListener("change", function () {
    var file = input.files && input.files[0];
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return;

    var url = URL.createObjectURL(file);
    var image = new Image();

    image.onload = function () {
      URL.revokeObjectURL(url);
      var side = Math.min(image.naturalWidth, image.naturalHeight);
      if (!side) return;

      var canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      var context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(
        image,
        (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
        0, 0, SIZE, SIZE
      );

      canvas.toBlob(function (blob) {
        if (!blob) return;
        try {
          var shrunk = new File([blob], "avatar", { type: blob.type });
          var transfer = new DataTransfer();
          transfer.items.add(shrunk);
          input.files = transfer.files;
        } catch (error) {
          /* Leave the original in place; the server will judge it. */
        }
      }, "image/webp", 0.9);
    };

    image.onerror = function () {
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
})();
