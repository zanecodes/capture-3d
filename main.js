let capture = false;
let xrSession = null;
let transforms = {
  frames: []
};
let images = [];
let imageCount = 0;
let imageFile = "";

const download = document.createElement("canvas");
const downloadContext = download.getContext("2d");
const a = document.createElement("a");

const vertexShaderSource = `
uniform mat4 u_projectionMatrix, u_viewMatrix, u_modelMatrix;

attribute vec4 a_position;
attribute vec2 a_texture_position;

varying highp vec2 v_texture_position;

void main() {
  gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * a_position;
  v_texture_position = a_texture_position;
}
`;

const fragmentShaderSource = `
varying highp vec2 v_texture_position;
uniform sampler2D u_sampler;

precision mediump float;

void main() {
  //gl_FragColor = vec4(v_texture_position.x, v_texture_position.y, 0, 1);
  vec4 col = texture2D(u_sampler, v_texture_position);
  gl_FragColor.rgb = col.rgb;
  gl_FragColor.a = 1.0;
}
`;

function rotate(r, s) {
  return [
    r[0] * s[0] - r[1] * s[1] - r[2] * s[2] - r[3] * s[3],
    r[0] * s[1] + r[1] * s[0] - r[2] * s[3] + r[3] * s[2],
    r[0] * s[2] + r[1] * s[3] + r[2] * s[0] - r[3] * s[1],
    r[0] * s[3] - r[1] * s[2] + r[2] * s[1] + r[3] * s[0],
  ];
}

navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
  if (supported) {
    document.getElementById("overlay").addEventListener("click", () => {
      if (!xrSession) {
        navigator.xr.requestSession("immersive-ar", { requiredFeatures: ["camera-access", "dom-overlay"], domOverlay: { root: document.getElementById("overlay") } }).then(
          (session) => {
            xrSession = session;

            const canvas = document.getElementById("canvas");
            const gl = canvas.getContext("webgl", { xrCompatible: true });
            const glBinding = new XRWebGLBinding(session, gl);

            const vertexShader = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vertexShader, vertexShaderSource);
            gl.compileShader(vertexShader);
            if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
              console.log(gl.getShaderInfoLog(vertexShader));
              gl.deleteShader(vertexShader);
            }

            const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fragmentShader, fragmentShaderSource);
            gl.compileShader(fragmentShader);
            if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
              console.log(gl.getShaderInfoLog(fragmentShader));
              gl.deleteShader(fragmentShader);
            }

            const program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
              console.log(gl.getProgramInfoLog(program));
              gl.deleteProgram(program);
            }

            const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
            const positionBuffer = gl.createBuffer();

            const texture_positions = [
              1, 0,
              0, 0,
              1, 1,
              0, 1
            ];

            const texturePositionAttributeLocation = gl.getAttribLocation(program, "a_texture_position");
            const texturePositionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, texturePositionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texture_positions), gl.STATIC_DRAW);

            const projectionMatrixAttributeLocation = gl.getUniformLocation(program, "u_projectionMatrix");
            const viewMatrixAttributeLocation = gl.getUniformLocation(program, "u_viewMatrix");
            const modelMatrixAttributeLocation = gl.getUniformLocation(program, "u_modelMatrix");
            const samplerUniformLocation = gl.getUniformLocation(program, "u_sampler");

            const frameBuffer = gl.createFramebuffer();

            session.addEventListener("end", () => {
              xrSession = null;

              a.download = "transforms.json";
              a.href = URL.createObjectURL(new Blob([new TextEncoder().encode(JSON.stringify(transforms))], { type: "application/json;charset=utf-8" }));
              a.click();
              URL.revokeObjectURL(a.href);

              a.download = "images.txt";
              a.href = URL.createObjectURL(new Blob([new TextEncoder().encode(imageFile)], { type: "application/text;charset=utf-8" }));
              a.click();
              URL.revokeObjectURL(a.href);

              // TODO
            });

            session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
            session.requestReferenceSpace("local").then((refSpace) => {
              refSpace.addEventListener("reset", (event) => {
                // TODO
                console.log("Space reset");
                images = [];
              });

              function onXRFrame(time, frame) {
                frame.session.requestAnimationFrame(onXRFrame);

                const pose = frame.getViewerPose(refSpace);

                if (pose) {
                  for (const view of pose.views) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
                    gl.clearColor(0, 0, 0, 0);
                    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                    gl.enable(gl.DEPTH_TEST);

                    gl.bindBuffer(gl.ARRAY_BUFFER, texturePositionBuffer);
                    gl.vertexAttribPointer(texturePositionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
                    gl.enableVertexAttribArray(texturePositionAttributeLocation);

                    gl.useProgram(program);

                    const viewport = session.renderState.baseLayer.getViewport(view);
                    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

                    gl.uniformMatrix4fv(projectionMatrixAttributeLocation, false, view.projectionMatrix);
                    gl.uniformMatrix4fv(viewMatrixAttributeLocation, false, view.transform.inverse.matrix);

                    for (const image of images) {
                      const positions = [
                        image.width * 0.0001,  image.height * -0.0001, -0.3,
                        image.width * -0.0001, image.height * -0.0001, -0.3,
                        image.width * 0.0001,  image.height * 0.0001, -0.3,
                        image.width * -0.0001, image.height * 0.0001, -0.3
                      ];

                      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
                      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
                      gl.vertexAttribPointer(positionAttributeLocation, 3, gl.FLOAT, false, 0, 0);
                      gl.enableVertexAttribArray(positionAttributeLocation);
                      
                      gl.activeTexture(gl.TEXTURE0);
                      gl.bindTexture(gl.TEXTURE_2D, image.image);

                      gl.uniform1i(samplerUniformLocation, 0);
                      gl.uniformMatrix4fv(modelMatrixAttributeLocation, false, image.matrix);
                      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                    }

                    if (view.camera) {
                      const texture = glBinding.getCameraImage(view.camera);

                      if (capture) {
                        capture = false;

                        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
                        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

                        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE) {
                          const data = new Uint8Array(view.camera.width * view.camera.height * 4);
                          gl.readPixels(0, 0, view.camera.width, view.camera.height, gl.RGBA, gl.UNSIGNED_BYTE, data);

                          const imageTexture = gl.createTexture();
                          gl.bindTexture(gl.TEXTURE_2D, imageTexture);
                          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, view.camera.width, view.camera.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
                          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

                          download.width = view.camera.width;
                          download.height = view.camera.height;

                          const imageData = downloadContext.createImageData(download.width, download.height);

                          for (let row = 0; row < download.height; row += 1) {
                            imageData.data.set(data.subarray(row * download.width * 4, (row + 1) * download.width * 4), download.width * download.height * 4 - (1 + row) * download.width * 4);
                          }

                          const filename = `test_${imageCount}.png`;

                          // TODO: replace this with https://wicg.github.io/file-system-access/#api-showsavefilepicker
                          downloadContext.putImageData(imageData, 0, 0);
                          download.toBlob((blob) => {
                            a.download = filename;
                            imageCount++;
                            a.href = URL.createObjectURL(blob);
                            a.click();
                            URL.revokeObjectURL(a.href);
                          });

                          // TODO: all of this
                          transforms.camera_angle_x = 0.9455683254293294;
                          transforms.camera_angle_y =  0.5606463943310849;
                          transforms.fl_x =  1876.930359891481;
                          transforms.fl_y =  1875.6233855373773;
                          transforms.k1 =  0.07479678694152314;
                          transforms.k2 =  -0.17800556693768493;
                          transforms.k3 =  0;
                          transforms.k4 =  0;
                          transforms.p1 =  0.000889719184276307;
                          transforms.p2 =  2.049068005788543e-05;
                          transforms.is_fisheye =  false;
                          transforms.cx =  960.0;
                          transforms.cy =  540.0;
                          transforms.w =  1920.0;
                          transforms.h =  1080.0;
                          transforms.aabb_scale =  32;

                          transforms.frames.push({
                            file_path: `./${filename}`,
                            sharpness: 2000, // TODO: actually compute this
                            transform_matrix: [ // TODO: this is dumb
                              [
                                view.transform.matrix[0],
                                view.transform.matrix[4],
                                view.transform.matrix[8],
                                view.transform.matrix[12]
                              ],
                              [
                                view.transform.matrix[1],
                                view.transform.matrix[5],
                                view.transform.matrix[9],
                                view.transform.matrix[13]
                              ],
                              [
                                view.transform.matrix[2],
                                view.transform.matrix[6],
                                view.transform.matrix[10],
                                view.transform.matrix[14]
                              ],
                              [
                                view.transform.matrix[3],
                                view.transform.matrix[7],
                                view.transform.matrix[11],
                                view.transform.matrix[15]
                              ]
                            ]
                          });

                          images.push({
                            filename: filename,
                            image: imageTexture,
                            width: view.camera.width,
                            height: view.camera.height,
                            matrix: view.transform.matrix,
                          });

                          imageFile += `${imageCount} ${view.transform.orientation.w} ${view.transform.orientation.x} ${view.transform.orientation.y} ${view.transform.orientation.z} ${view.transform.position.x} ${view.transform.position.y} ${view.transform.position.z} 1 ${filename}\n\n`;
                        }
                      }
                    }
                  }
                }
              }

              session.requestAnimationFrame(onXRFrame);
            });
          },
          (error) => {
            alert(`Unable to initialize WebXR: ${error.message}`);
            // TODO: better error messaging, add click me message, add way to exit AR
          }
        );
      }
      else {
        capture = true;
      }
    });
  }
});
