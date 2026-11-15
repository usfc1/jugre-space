// Both Earth renderers use the same subdued ocean reflection, so the water
// keeps its appearance as the local horizon gives way to the globe.
export const earthSurfaceShader = `
  vec3 earthOceanLight(vec3 base,vec3 normal,vec3 viewDirection,vec3 lightDirection){
    vec3 n=normalize(normal),v=normalize(viewDirection),l=normalize(lightDirection);
    float ocean=smoothstep(.004,.035,base.b-max(base.r,base.g));
    float daylight=smoothstep(-.02,.25,dot(n,l));
    float glint=pow(max(0.,dot(reflect(-l,n),v)),96.);
    float rim=pow(1.-max(0.,dot(n,v)),3.);
    return ocean*daylight*(vec3(.055,.075,.09)*glint+vec3(.004,.009,.015)*rim);
  }
`;
