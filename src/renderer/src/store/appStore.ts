import { createStore } from 'jotai'

/** The one jotai store for the app. Explicit (not the implicit default
 *  store) because the document-session registry writes atoms from outside
 *  React — with a bare <Provider> those writes would land in a different
 *  store than the components read. */
export const appStore = createStore()
