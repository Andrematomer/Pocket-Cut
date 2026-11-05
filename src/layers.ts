import { drawFrame, type DrawOptions } from './geometry.ts';
import type { Clip, Grade } from './types.ts';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const NO_GRADE: Grade = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

export const isGraded = (g?: Grade): g is Grade => !!g && (g.brightness !== 0 || g.contrast !== 0 || g.saturation !== 0 || g.warmth !== 0);

/** Pure per-pixel colour maths (the same as the shader), rgb 0..1. Used by tests. */
export function gradePixel(rgb: [number, number, number], g: Grade): [number, number, number] {
  let [r, gr, b] = rgb;
  r += g.brightness * 0.5 + g.warmth * 0.12;
  gr += g.brightness * 0.5;
  b += g.brightness * 0.5 - g.warmth * 0.12;
  const k = 1 + g.contrast;
  r = (r - 0.5) * k + 0.5;
  gr = (gr - 0.5) * k + 0.5;
  b = (b - 0.5) * k + 0.5;
  const y = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
  const s = 1 + g.saturation;
  const cl = (x: number) => Math.min(1, Math.max(0, x));
  return [cl(y + (r - y) * s), cl(y + (gr - y) * s), cl(y + (b - y) * s)];
}

const VERT = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform vec4 g;
void main(){vec4 c=texture2D(tex,uv);vec3 r=c.a>0.0?c.rgb/c.a:c.rgb;
r+=vec3(g.x*.5+g.w*.12,g.x*.5,g.x*.5-g.w*.12);
r=(r-.5)*(1.+g.y)+.5;
float y=dot(r,vec3(.2126,.7152,.0722));
r=clamp(vec3(y)+(r-vec3(y))*(1.+g.z),0.,1.);
gl_FragColor=vec4(r*c.a,c.a);}`;

interface Gl {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  gl: WebGLRenderingContext;
  tex: WebGLTexture;
  loc: WebGLUniformLocation;
}

let shared: Gl | null | undefined;

function setup(): Gl | null {
  if (shared !== undefined) return shared;
  shared = null;
  try {
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas');
    const gl = (canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false }) as WebGLRenderingContext | null) ?? null;
    if (!gl) return null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    shared = { canvas, gl, tex, loc: gl.getUniformLocation(prog, 'g')! };
  } catch {
    shared = null;
  }
  return shared;
}

const MAX_SIDE = 3840;

/** Runs the picture through the grading shader. Returns the shared graded canvas (use it at once), or null when WebGL is missing. */
function grade(src: CanvasImageSource, w: number, h: number, g: Grade): { img: CanvasImageSource; w: number; h: number } | null {
  const s = setup();
  if (!s) return null;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const gw = Math.max(2, Math.round(w * k));
  const gh = Math.max(2, Math.round(h * k));
  try {
    if (s.canvas.width !== gw || s.canvas.height !== gh) {
      s.canvas.width = gw;
      s.canvas.height = gh;
    }
    const gl = s.gl;
    gl.viewport(0, 0, gw, gh);
    gl.bindTexture(gl.TEXTURE_2D, s.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    gl.uniform4f(s.loc, g.brightness, g.contrast, g.saturation, g.warmth);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return { img: s.canvas as CanvasImageSource, w: gw, h: gh };
  } catch {
    return null;
  }
}

export interface LayerLook {
  opacity?: number;
  grade?: Grade;
  crop?: Clip['crop'];
}

/** Draws one clip's picture with its own opacity, colour grade and crop on top of what is on the canvas. */
export function drawLayer(ctx: Ctx2D, src: CanvasImageSource, sw: number, sh: number, look: LayerLook, o: DrawOptions): void {
  const opts: DrawOptions = { ...o, alpha: look.opacity ?? 1, crop: look.crop };
  if (isGraded(look.grade)) {
    const r = grade(src, sw, sh, look.grade);
    if (r) {
      drawFrame(ctx, r.img, sw, sh, { ...opts, srcW: r.w, srcH: r.h });
      return;
    }
  }
  drawFrame(ctx, src, sw, sh, opts);
}
