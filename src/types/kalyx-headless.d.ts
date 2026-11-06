// Bridge the official subpath's types for legacy moduleResolution: "node".
// Runtime imports continue to use @kalyx/react's conditional exports.
declare module '@kalyx/react/headless' {
  export {
    useDateTimePicker,
    type UseDateTimePickerOptions,
    type UseDateTimePickerReturn,
  } from '@kalyx/react/dist/headless';
}
