<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useAppStore } from "../stores/app";
import { useToastStore } from "../stores/toast";
import GlassField from "./ui/GlassField.vue";
import GlassTip from "./ui/GlassTip.vue";

const app = useAppStore();
const toast = useToastStore();
const password = ref("");
const confirmPassword = ref("");
const booting = ref(true);

const isOsMode = computed(() => app.vault.protection === "os");
const showPasswordForm = computed(
  () => !app.vault.initialized || app.vault.protection === "password",
);

function fail(msg: string): void {
  toast.error(msg || app.error || "操作失败");
}

async function submit(): Promise<void> {
  if (!password.value || password.value.length < 6) {
    fail("主密码至少 6 位");
    return;
  }
  if (!app.vault.initialized) {
    if (password.value !== confirmPassword.value) {
      fail("两次输入的主密码不一致");
      return;
    }
    const ok = await app.setup(password.value);
    if (!ok) fail(app.error);
  } else {
    const ok = await app.unlock(password.value);
    if (!ok) fail(app.error);
  }
}

async function setupWithoutPassword(): Promise<void> {
  if (!app.vault.osUnlockAvailable) {
    fail("当前系统不支持本机自动解锁，请使用主密码");
    return;
  }
  const ok = await app.setupOs();
  if (!ok) fail(app.error);
}

async function unlockWithoutPassword(): Promise<void> {
  const ok = await app.unlockOs();
  if (!ok) fail(app.error);
}

async function forgotPassword(): Promise<void> {
  const yes = window.confirm(
    "主密码无法找回（本地加密）。\n\n清空保险库将删除全部主机、片段、书签等数据，且不可恢复。\n\n确定清空并重新开始？",
  );
  if (!yes) return;
  const again = window.confirm("请再次确认：真的要清空全部本地数据吗？");
  if (!again) return;
  const ok = await app.resetVault();
  if (!ok) fail(app.error || "清空失败");
}

onMounted(async () => {
  await app.refreshStatus();
  if (app.vault.canAutoUnlock) {
    const ok = await app.tryAutoUnlock();
    if (!ok) fail(app.error || "自动解锁失败");
  }
  booting.value = false;
});
</script>

<template>
  <div class="unlock">
    <div class="orb a" />
    <div class="orb b" />
    <div class="card glass-panel">
      <div class="inner">
        <div class="mark">SSH</div>
        <div class="brand">SSH Client Plus</div>
        <p class="desc">
          <template v-if="booting">正在准备…</template>
          <template v-else-if="!app.vault.initialized">
            首次使用：可设置主密码，或开启本机自动解锁（免输密码）
          </template>
          <template v-else-if="isOsMode"
            >本机保护模式，点击即可进入（无需主密码）</template
          >
          <template v-else>输入主密码解锁本地主机库</template>
        </p>

        <div v-if="booting" class="booting">自动解锁中…</div>

        <template v-else-if="isOsMode && app.vault.initialized">
          <button
            class="btn-accent submit"
            type="button"
            :disabled="app.busy"
            @click="unlockWithoutPassword"
          >
            {{ app.busy ? "处理中…" : "进入" }}
          </button>
          <button
            class="btn-glass forgot"
            type="button"
            :disabled="app.busy"
            @click="forgotPassword"
          >
            重置保险库
          </button>
        </template>

        <form v-else-if="showPasswordForm" @submit.prevent="submit">
          <GlassField label="主密码">
            <input
              v-model="password"
              class="glass-field"
              type="password"
              autocomplete="current-password"
              autofocus
            />
          </GlassField>
          <GlassField v-if="!app.vault.initialized" label="确认主密码">
            <input
              v-model="confirmPassword"
              class="glass-field"
              type="password"
              autocomplete="new-password"
            />
          </GlassField>
          <button class="btn-accent submit" type="submit" :disabled="app.busy">
            {{
              app.busy
                ? "处理中…"
                : app.vault.initialized
                  ? "解锁"
                  : "创建并进入"
            }}
          </button>

          <template v-if="!app.vault.initialized">
            <div class="divider"><span>或</span></div>
            <GlassTip
              :text="
                app.vault.osUnlockAvailable
                  ? '使用 Windows 凭据保护，以后打开无需输入密码'
                  : '当前系统不支持'
              "
              mode="wrap"
            >
              <button
                class="btn-glass os-btn"
                type="button"
                :disabled="app.busy || !app.vault.osUnlockAvailable"
                @click="setupWithoutPassword"
              >
                本机自动解锁（免密）
              </button>
            </GlassTip>
            <p class="os-hint">
              数据仍加密保存在本机；由当前 Windows
              用户凭据保护。登录此电脑的用户均可打开本库。
            </p>
          </template>

          <button
            v-if="app.vault.initialized"
            class="btn-glass forgot"
            type="button"
            :disabled="app.busy"
            @click="forgotPassword"
          >
            忘记主密码？清空并重新开始
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unlock {
  position: relative;
  height: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.55;
  pointer-events: none;
}

.orb.a {
  width: 280px;
  height: 280px;
  background: #3b82f6;
  top: 12%;
  left: 18%;
}

.orb.b {
  width: 220px;
  height: 220px;
  background: #22d3ee;
  bottom: 16%;
  right: 14%;
}

.card {
  position: relative;
  z-index: 1;
  width: min(420px, calc(100% - 32px));
  border-radius: 22px;
}

.inner {
  padding: 28px 26px 24px;
}

.mark {
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.brand {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.desc {
  margin: 10px 0 22px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.booting {
  color: var(--text-muted);
  font-size: 13px;
}

.submit {
  width: 100%;
  margin-top: 14px;
}

.forgot {
  width: 100%;
  margin-top: 10px;
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.divider::before,
.divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--glass-border);
}

.os-btn {
  width: 100%;
}

.os-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}
</style>
