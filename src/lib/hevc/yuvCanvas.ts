/** Рисует кадры YUV 4:2:0 на canvas через WebGL: перевод цвета делает видеокарта, процессор свободен. */
export class YuvCanvas {
  private gl: WebGLRenderingContext | null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private tex: WebGLTexture[] = [];
  private canvas: HTMLCanvasElement;
  private img: ImageData | null = null;

  get ok(): boolean { return !!(this.gl || this.ctx2d); }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = null;
    try {
      this.gl = this.initGl(canvas);
    } catch {
      this.gl = null;
    }
    if (!this.gl) {
      try { this.ctx2d = canvas.getContext('2d'); } catch { this.ctx2d = null; }
    }
  }

  private initGl(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
    const opts = { preserveDrawingBuffer: true, antialias: false, alpha: false, depth: false, stencil: false };
    const gl = (canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null;
    if (!gl) return null;
    const vs = `attribute vec2 p;varying vec2 t;void main(){t=vec2((p.x+1.0)/2.0,(1.0-p.y)/2.0);gl_Position=vec4(p,0.0,1.0);}`;
    const fs = `precision mediump float;varying vec2 t;uniform sampler2D Y;uniform sampler2D U;uniform sampler2D V;
      void main(){float y=1.1643*(texture2D(Y,t).r-0.0625);float u=texture2D(U,t).r-0.5;float v=texture2D(V,t).r-0.5;
      gl_FragColor=vec4(y+1.5958*v,y-0.39173*u-0.81290*v,y+2.017*u,1.0);}`;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error('shader');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader');
      return s;
    };
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    ['Y', 'U', 'V'].forEach((n, i) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, n), i);
      this.tex.push(t);
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.gl = null;
      this.tex = [];
    }, { once: true });
    return gl;
  }

  draw(f: { w: number; h: number; cw: number; ch: number; y: Uint8Array; u: Uint8Array; v: Uint8Array }) {
    if (this.canvas.width !== f.w || this.canvas.height !== f.h) { this.canvas.width = f.w; this.canvas.height = f.h; }
    const gl = this.gl;
    if (!gl || gl.isContextLost()) { this.draw2d(f); return; }
    gl.viewport(0, 0, f.w, f.h);
    const planes: [Uint8Array, number, number][] = [[f.y, f.w, f.h], [f.u, f.cw, f.ch], [f.v, f.cw, f.ch]];
    planes.forEach(([data, w, h], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
    });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private draw2d(f: { w: number; h: number; cw: number; y: Uint8Array; u: Uint8Array; v: Uint8Array }) {
    if (!this.ctx2d) {
      try { this.ctx2d = this.canvas.getContext('2d'); } catch { this.ctx2d = null; }
      if (!this.ctx2d) return;
    }
    if (!this.img || this.img.width !== f.w || this.img.height !== f.h) this.img = this.ctx2d.createImageData(f.w, f.h);
    const img = this.img;
    const d = img.data;
    for (let j = 0; j < f.h; j++) {
      for (let i = 0; i < f.w; i++) {
        const Y = 1.1643 * (f.y[j * f.w + i] - 16);
        const ci = (j >> 1) * f.cw + (i >> 1);
        const U = f.u[ci] - 128, V = f.v[ci] - 128;
        const o = (j * f.w + i) * 4;
        d[o] = Y + 1.5958 * V; d[o + 1] = Y - 0.39173 * U - 0.8129 * V; d[o + 2] = Y + 2.017 * U; d[o + 3] = 255;
      }
    }
    this.ctx2d.putImageData(img, 0, 0);
  }
}
