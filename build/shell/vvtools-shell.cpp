#define NOMINMAX
#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <wrl.h>
#include <algorithm>
#include <atomic>
#include <cwctype>
#include <memory>
#include <string>
#include <utility>
#include <vector>

using namespace Microsoft::WRL;
const CLSID ShellClsid = {0xd8e3eb9a, 0x31f4, 0x4795, {0xad, 0x5e, 0x31, 0xfe, 0xc0, 0x6f, 0x3a, 0xa1}};
const wchar_t* SettingsKey = L"Software\\VVTools\\Shell";
std::atomic<long> objects{0}, locks{0};
struct Counted {
  Counted() { ++objects; }
  virtual ~Counted() { --objects; }
};

std::wstring readText(const wchar_t* name) {
  DWORD bytes = 0;
  if (RegGetValueW(HKEY_CURRENT_USER, SettingsKey, name, RRF_RT_REG_SZ, nullptr, nullptr, &bytes) != ERROR_SUCCESS || bytes > 65536) return {};
  std::wstring value(bytes / sizeof(wchar_t), L'\0');
  if (RegGetValueW(HKEY_CURRENT_USER, SettingsKey, name, RRF_RT_REG_SZ, nullptr, value.data(), &bytes) != ERROR_SUCCESS) return {};
  value.resize(wcslen(value.c_str()));
  return value;
}
bool enabled(const std::wstring& id) {
  DWORD value = 0, bytes = sizeof(value);
  return RegGetValueW(HKEY_CURRENT_USER, SettingsKey, (id + L"-enabled").c_str(), RRF_RT_REG_DWORD, nullptr, &value, &bytes) == ERROR_SUCCESS && value == 1;
}
std::string utf8(const std::wstring& value) {
  int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(size, '\0');
  if (size) WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.c_str(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
  return result;
}
std::string jsonString(const std::wstring& value) {
  const char* hex = "0123456789abcdef";
  std::string result = "\"";
  for (unsigned char ch : utf8(value)) {
    if (ch == '"' || ch == '\\') { result += '\\'; result += ch; }
    else if (ch < 32) { result += "\\u00"; result += hex[ch >> 4]; result += hex[ch & 15]; }
    else result += ch;
  }
  return result + '"';
}
std::wstring argument(const std::wstring& value) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (wchar_t ch : value) {
    if (ch == L'\\') { ++slashes; continue; }
    result.append(ch == L'"' ? slashes * 2 + 1 : slashes, L'\\');
    slashes = 0;
    result += ch;
  }
  result.append(slashes * 2, L'\\');
  return result + L'"';
}
HRESULT selectionPaths(IShellItemArray* items, std::vector<std::wstring>& paths) {
  if (!items) return E_INVALIDARG;
  DWORD count = 0;
  HRESULT hr = items->GetCount(&count);
  if (FAILED(hr)) return hr;
  if (!count || count > 500) return E_INVALIDARG;
  for (DWORD index = 0; index < count; ++index) {
    ComPtr<IShellItem> item;
    hr = items->GetItemAt(index, &item);
    if (FAILED(hr)) return hr;
    PWSTR path = nullptr;
    hr = item->GetDisplayName(SIGDN_FILESYSPATH, &path);
    if (FAILED(hr)) return hr;
    std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> ownedPath(path, CoTaskMemFree);
    if (!path) return E_INVALIDARG;
    paths.emplace_back(ownedPath.get());
  }
  return S_OK;
}
bool imagePath(const std::wstring& path) {
  std::wstring extension = PathFindExtensionW(path.c_str());
  std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t ch) { return static_cast<wchar_t>(towlower(ch)); });
  return extension == L".jpg" || extension == L".jpeg" || extension == L".png" || extension == L".webp";
}
HRESULT launch(const std::wstring& action, const std::vector<std::wstring>& paths) {
  const auto executable = readText(L"Executable"), directory = readText(L"RequestDirectory");
  if (executable.empty() || directory.empty()) return E_FAIL;
  GUID guid;
  HRESULT hr = CoCreateGuid(&guid);
  if (FAILED(hr)) return hr;
  wchar_t buffer[40];
  StringFromGUID2(guid, buffer, 40);
  const std::wstring id(buffer + 1, 36);
  const auto file = directory + L"\\" + id + L".json";
  std::string request = "{\"version\":1,\"id\":" + jsonString(id) + ",\"actionId\":" + jsonString(action) + ",\"paths\":[";
  for (size_t index = 0; index < paths.size(); ++index) request += (index ? "," : "") + jsonString(paths[index]);
  request += "]}";
  if (request.size() > 1024 * 1024) return E_INVALIDARG;
  HANDLE handle = CreateFileW(file.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return HRESULT_FROM_WIN32(GetLastError());
  DWORD written = 0;
  const BOOL saved = WriteFile(handle, request.data(), static_cast<DWORD>(request.size()), &written, nullptr);
  const DWORD error = GetLastError();
  CloseHandle(handle);
  if (!saved || written != request.size()) { DeleteFileW(file.c_str()); return HRESULT_FROM_WIN32(saved ? ERROR_WRITE_FAULT : error); }
  auto command = argument(executable) + L" --vvtools-request " + argument(file);
  STARTUPINFOW startup = {sizeof(startup)};
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startup, &process)) {
    const DWORD code = GetLastError();
    DeleteFileW(file.c_str());
    return HRESULT_FROM_WIN32(code);
  }
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return S_OK;
}

class Commands final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IEnumExplorerCommand>, public Counted {
 public:
  std::vector<ComPtr<IExplorerCommand>> items;
  ULONG position = 0;
  IFACEMETHODIMP Next(ULONG count, IExplorerCommand** out, ULONG* fetched) override {
    if (!out || (!fetched && count != 1)) return E_POINTER;
    ULONG total = 0;
    while (total < count && position < items.size()) items[position++].CopyTo(&out[total++]);
    if (fetched) *fetched = total;
    return total == count ? S_OK : S_FALSE;
  }
  IFACEMETHODIMP Skip(ULONG count) override {
    const ULONG available = static_cast<ULONG>(items.size()) - position;
    position += std::min(count, available);
    return count <= available ? S_OK : S_FALSE;
  }
  IFACEMETHODIMP Reset() override { position = 0; return S_OK; }
  IFACEMETHODIMP Clone(IEnumExplorerCommand** out) override {
    if (!out) return E_POINTER;
    *out = nullptr;
    try {
      const auto clone = Make<Commands>();
      if (!clone) return E_OUTOFMEMORY;
      clone->items = items;
      clone->position = position;
      return clone.CopyTo(out);
    } catch (...) { return E_OUTOFMEMORY; }
  }
};
class Command final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IExplorerCommand>, public Counted {
 public:
  std::wstring action;
  Command() = default;
  explicit Command(std::wstring id) : action(std::move(id)) {}
  IFACEMETHODIMP GetTitle(IShellItemArray*, LPWSTR* title) override {
    if (!title) return E_POINTER;
    *title = nullptr;
    try {
      const std::wstring name = action.empty() ? L"VVTools" : action == L"open" ? L"添加到 VVTools" : readText((action + L"-name").c_str());
      return SHStrDupW(name.c_str(), title);
    } catch (...) { return E_OUTOFMEMORY; }
  }
  IFACEMETHODIMP GetIcon(IShellItemArray*, LPWSTR* icon) override {
    if (!icon) return E_POINTER;
    *icon = nullptr;
    try { return SHStrDupW((readText(L"Executable") + L",0").c_str(), icon); }
    catch (...) { return E_OUTOFMEMORY; }
  }
  IFACEMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* tip) override { if (!tip) return E_POINTER; *tip = nullptr; return E_NOTIMPL; }
  IFACEMETHODIMP GetCanonicalName(GUID* name) override {
    if (!name) return E_POINTER;
    *name = ShellClsid;
    name->Data1 += action == L"image-share" ? 1 : action == L"image-web" ? 2 : action == L"open" ? 3 : 0;
    return S_OK;
  }
  IFACEMETHODIMP GetState(IShellItemArray* items, BOOL, EXPCMDSTATE* state) override {
    if (!state) return E_POINTER;
    *state = ECS_DISABLED;
    try {
      std::vector<std::wstring> paths;
      if (readText(L"Executable").empty() || FAILED(selectionPaths(items, paths))) return S_OK;
      if (action.empty() || action == L"open" || (enabled(action) && std::all_of(paths.begin(), paths.end(), imagePath))) *state = ECS_ENABLED;
      return S_OK;
    } catch (...) { return E_OUTOFMEMORY; }
  }
  IFACEMETHODIMP Invoke(IShellItemArray* items, IBindCtx*) override {
    try {
      if (action.empty() || (action != L"open" && !enabled(action))) return E_ACCESSDENIED;
      std::vector<std::wstring> paths;
      HRESULT hr = selectionPaths(items, paths);
      if (FAILED(hr)) return hr;
      return launch(action, paths);
    } catch (...) { return E_OUTOFMEMORY; }
  }
  IFACEMETHODIMP GetFlags(EXPCMDFLAGS* flags) override { if (!flags) return E_POINTER; *flags = action.empty() ? ECF_HASSUBCOMMANDS : ECF_DEFAULT; return S_OK; }
  IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** out) override {
    if (!out) return E_POINTER;
    *out = nullptr;
    if (!action.empty()) return E_NOTIMPL;
    try {
      const auto commands = Make<Commands>();
      if (!commands) return E_OUTOFMEMORY;
      const bool webFirst = readText(L"ActionOrder").find(L"image-web") == 0;
      for (const auto& id : webFirst ? std::vector<std::wstring>{L"image-web", L"image-share"} : std::vector<std::wstring>{L"image-share", L"image-web"})
        if (enabled(id)) commands->items.push_back(Make<Command>(id));
      commands->items.push_back(Make<Command>(L"open"));
      return commands.CopyTo(out);
    } catch (...) { return E_OUTOFMEMORY; }
  }
};
class Factory final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IClassFactory>, public Counted {
 public:
  IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID iid, void** out) override {
    if (outer) return CLASS_E_NOAGGREGATION;
    auto command = Make<Command>();
    return command ? command.CopyTo(iid, out) : E_OUTOFMEMORY;
  }
  IFACEMETHODIMP LockServer(BOOL lock) override { lock ? ++locks : --locks; return S_OK; }
};
STDAPI DllGetClassObject(REFCLSID clsid, REFIID iid, void** out) {
  if (clsid != ShellClsid) return CLASS_E_CLASSNOTAVAILABLE;
  const auto factory = Make<Factory>();
  return factory ? factory.CopyTo(iid, out) : E_OUTOFMEMORY;
}
STDAPI DllCanUnloadNow() { return objects == 0 && locks == 0 ? S_OK : S_FALSE; }
