import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config({ignores:['**/node_modules/**','**/.next/**','artifacts/**','test-results/**']},{files:['apps/**/*.ts','apps/**/*.tsx','tests/**/*.ts','prisma/**/*.ts'],languageOptions:{parser:tseslint.parser},plugins:{'react-hooks':hooks},rules:{'constructor-super':'error','no-constant-condition':'error','no-dupe-args':'error','no-duplicate-case':'error','no-self-assign':'error','no-unsafe-finally':'error','valid-typeof':'error','react-hooks/rules-of-hooks':'error'}});
