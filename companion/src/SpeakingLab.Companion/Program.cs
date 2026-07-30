using System.Net;
using System.Net.Http.Headers;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http.Json;

var options = CompanionOptions.Parse(args);
Directory.CreateDirectory(options.DataDirectory);

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWindowsService(service =>
{
    service.ServiceName = "SpeakingLabVoiceCompanion";
});
builder.WebHost.UseKestrel(kestrel =>
{
    // This is the central security invariant: never listen on Any/IP/LAN.
    kestrel.Listen(IPAddress.Loopback, options.Port);
    // Enforced while Kestrel reads both Content-Length and chunked bodies.
    kestrel.Limits.MaxRequestBodySize = 16_384;
});
builder.Services.Configure<JsonOptions>(json =>
{
    json.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});
builder.Services.AddSingleton(options);
builder.Services.AddSingleton<PairingStore>();
builder.Services.AddSingleton<PairingRateLimiter>();
builder.Services.AddSingleton<WorkerAccessToken>();
builder.Services.AddSingleton<ModelPackageManager>();
builder.Services.AddSingleton<WorkerProcessHost>();
builder.Services.AddHostedService(services => services.GetRequiredService<WorkerProcessHost>());
builder.Services.AddHttpClient<LocalWorkerClient>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(60);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("SpeakingLab-Voice-Companion/1.0");
});

var app = builder.Build();
var pairing = app.Services.GetRequiredService<PairingStore>();

if (options.RotatePairingOnly)
{
    Console.WriteLine($"Speaking Lab one-time pairing code: {pairing.RotateBootstrapCode()}");
    return;
}
if (options.AuthorizeModelInstallOnly)
{
    Console.WriteLine($"Speaking Lab one-time model installation code: {pairing.RotateModelInstallCode()}");
    return;
}

if (options.RotatePairing || !pairing.HasBootstrapCode)
{
    var code = pairing.RotateBootstrapCode();
    Console.WriteLine($"Speaking Lab one-time pairing code: {code}");
}

app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Cache-Control"] = "no-store";
    // Exact-origin CORS is the authorization boundary. The resource policy
    // must permit the intentionally cross-site HTTPS-app -> loopback fetch.
    context.Response.Headers["Cross-Origin-Resource-Policy"] = "cross-origin";

    var origin = context.Request.Headers.Origin.ToString();
    if (!string.IsNullOrWhiteSpace(origin))
    {
        if (!options.AllowedOrigins.Contains(origin, StringComparer.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { error = "origin_not_allowed" });
            return;
        }

        context.Response.Headers["Access-Control-Allow-Origin"] = origin;
        context.Response.Headers["Vary"] = "Origin";
        context.Response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
        context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        if (context.Request.Headers["Access-Control-Request-Private-Network"] == "true")
        {
            context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
        }
    }

    if (HttpMethods.IsOptions(context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status204NoContent;
        return;
    }

    await next();
});

app.Use(async (context, next) =>
{
    if (HttpMethods.IsPost(context.Request.Method))
    {
        var endpointLimit =
            context.Request.Path == "/pair" ||
            context.Request.Path == "/v1/models/install"
                ? 512L
                : 16_384L;
        var bodySize = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (bodySize is { IsReadOnly: false })
        {
            bodySize.MaxRequestBodySize = endpointLimit;
        }
        if (context.Request.ContentLength is long contentLength &&
            contentLength > endpointLimit)
        {
            context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            await context.Response.WriteAsJsonAsync(new { error = "request_too_large" });
            return;
        }
    }

    if (context.Request.Path == "/health" || context.Request.Path == "/pair")
    {
        await next();
        return;
    }

    var authorization = context.Request.Headers.Authorization.ToString();
    var origin = context.Request.Headers.Origin.ToString();
    if (!authorization.StartsWith("Bearer ", StringComparison.Ordinal) ||
        string.IsNullOrWhiteSpace(origin) ||
        !pairing.ValidateToken(authorization["Bearer ".Length..], origin))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { error = "pairing_required" });
        return;
    }

    await next();
});

app.MapGet("/health", async (
    WorkerProcessHost workerHost,
    LocalWorkerClient worker,
    CancellationToken ct) =>
{
    var workerHealth = await worker.GetHealthAsync(ct);
    var workerReady = workerHost.IsRunning && workerHealth.Reachable;
    return workerReady && workerHealth.ModelInstalled
        ? Results.Ok(new
        {
            status = "ok",
            version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "1.0.0",
            pairingRequired = !pairing.HasIssuedToken,
            workerReady = true,
            modelInstalled = true,
        })
        : Results.Json(
            new
            {
                status = "degraded",
                pairingRequired = !pairing.HasIssuedToken,
                workerReady,
                modelInstalled = workerHealth.ModelInstalled,
            },
            statusCode: StatusCodes.Status503ServiceUnavailable);
});

app.MapPost("/pair", async (
    HttpContext context,
    PairRequest request,
    PairingRateLimiter limiter) =>
{
    var origin = context.Request.Headers.Origin.ToString();
    if (string.IsNullOrWhiteSpace(origin))
    {
        return Results.BadRequest(new { error = "origin_required" });
    }

    if (!limiter.TryAcquire(context.Connection.RemoteIpAddress))
    {
        return Results.Json(
            new { error = "too_many_attempts" },
            statusCode: StatusCodes.Status429TooManyRequests);
    }

    var token = pairing.ExchangeBootstrapCode(request.Code ?? string.Empty, origin);
    if (token is null)
    {
        await Task.Delay(Random.Shared.Next(80, 180));
        return Results.Json(
            new { error = "invalid_pairing_code" },
            statusCode: StatusCodes.Status401Unauthorized);
    }

    return Results.Ok(new { token, expiresInDays = 180 });
});

app.MapPost("/unpair", (HttpContext context) =>
{
    var authorization = context.Request.Headers.Authorization.ToString();
    var token = authorization.StartsWith("Bearer ", StringComparison.Ordinal)
        ? authorization["Bearer ".Length..]
        : string.Empty;
    pairing.RevokeToken(token, context.Request.Headers.Origin.ToString());
    return Results.NoContent();
});

app.MapGet("/v1/models", async (LocalWorkerClient worker, CancellationToken ct) =>
    await worker.ProxyJsonAsync("/v1/models", ct));

app.MapGet("/v1/models/install/status", (ModelPackageManager models) =>
    Results.Ok(models.GetStatus()));

app.MapPost("/v1/models/install", async (
    HttpContext context,
    InstallModelRequest request,
    PairingStore pairingStore,
    PairingRateLimiter limiter,
    ModelPackageManager models,
    WorkerProcessHost workerHost,
    CancellationToken ct) =>
{
    if (!limiter.TryAcquire(context.Connection.RemoteIpAddress) ||
        !pairingStore.ValidateModelInstallCode(
            request.Code ?? string.Empty,
            context.Request.Headers.Origin.ToString()))
    {
        return Results.Json(
            new { error = "model_install_authorization_required" },
            statusCode: StatusCodes.Status403Forbidden);
    }
    try
    {
        var result = await models.InstallAsync(ct);
        pairingStore.InvalidateModelInstallCode(request.Code ?? string.Empty);
        workerHost.RequestRestart();
        return Results.Ok(result);
    }
    catch (InvalidOperationException error)
    {
        return Results.Json(
            new { error = "model_install_failed", detail = error.Message },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.MapGet("/v1/audio/voices", async (LocalWorkerClient worker, CancellationToken ct) =>
    await worker.ProxyJsonAsync("/v1/audio/voices", ct));

app.MapPost("/v1/audio/speech", async (
    SpeechRequest request,
    LocalWorkerClient worker,
    CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.Input) || request.Input.Length > 1_000)
    {
        return Results.BadRequest(new { error = "input_must_be_1_to_1000_characters" });
    }

    if (request.Speed is < 0.5 or > 2)
    {
        return Results.BadRequest(new { error = "speed_must_be_between_0_5_and_2" });
    }
    if (!string.Equals(request.ResponseFormat, "wav", StringComparison.Ordinal))
    {
        return Results.BadRequest(new { error = "response_format_must_be_wav" });
    }

    return await worker.StreamSpeechAsync(request, ct);
});

await app.RunAsync();

internal sealed record PairRequest(string? Code);
internal sealed record InstallModelRequest(string? Code);

internal sealed record SpeechRequest(
    string Input,
    string? Model,
    string? Voice,
    double Speed = 1,
    string ResponseFormat = "wav");

internal sealed class CompanionOptions
{
    public int Port { get; init; } = 17_841;
    public required string DataDirectory { get; init; }
    public required Uri WorkerEndpoint { get; init; }
    public required string[] AllowedOrigins { get; init; }
    public string? WorkerExecutable { get; init; }
    public Uri? ModelBaseUri { get; init; }
    public string? ModelSigningPublicKeyPath { get; init; }
    public bool RotatePairing { get; init; }
    public bool RotatePairingOnly { get; init; }
    public bool AuthorizeModelInstallOnly { get; init; }

    public static CompanionOptions Parse(string[] args)
    {
        var dataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "SpeakingLab",
            "Companion");
        var worker = new Uri("http://127.0.0.1:17842");
        var origins = (Environment.GetEnvironmentVariable("SPEAKINGLAB_ALLOWED_ORIGINS") ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(value => new Uri(value, UriKind.Absolute).GetLeftPart(UriPartial.Authority))
            .ToList();
        var rotate = false;
        var rotateOnly = false;
        var authorizeModelInstallOnly = false;
        string? workerExecutable = null;
        Uri? modelBaseUri = null;
        string? modelSigningPublicKeyPath = null;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--data-dir" when i + 1 < args.Length:
                    dataDirectory = Path.GetFullPath(args[++i]);
                    break;
                case "--worker" when i + 1 < args.Length:
                    worker = new Uri(args[++i], UriKind.Absolute);
                    break;
                case "--allowed-origin" when i + 1 < args.Length:
                    origins.Add(new Uri(args[++i], UriKind.Absolute).GetLeftPart(UriPartial.Authority));
                    break;
                case "--rotate-pairing":
                    rotate = true;
                    break;
                case "--rotate-pairing-only":
                    rotateOnly = true;
                    break;
                case "--authorize-model-install-only":
                    authorizeModelInstallOnly = true;
                    break;
                case "--worker-executable" when i + 1 < args.Length:
                    workerExecutable = Path.GetFullPath(args[++i]);
                    break;
                case "--model-base-url" when i + 1 < args.Length:
                    modelBaseUri = new Uri(args[++i].TrimEnd('/') + "/", UriKind.Absolute);
                    break;
                case "--model-signing-public-key" when i + 1 < args.Length:
                    modelSigningPublicKeyPath = Path.GetFullPath(args[++i]);
                    break;
            }
        }

        if (!IPAddress.TryParse(worker.Host, out var address) || !IPAddress.IsLoopback(address))
        {
            throw new InvalidOperationException("The local worker endpoint must use a loopback IP address.");
        }
        if (workerExecutable is not null)
        {
            var applicationDirectory = Path.TrimEndingDirectorySeparator(
                Path.GetFullPath(AppContext.BaseDirectory));
            var executableDirectory = Path.TrimEndingDirectorySeparator(
                Path.GetDirectoryName(workerExecutable) ?? string.Empty);
            if (!string.Equals(applicationDirectory, executableDirectory, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The packaged worker must be beside the companion executable.");
            }
        }
        if (modelBaseUri is not null && modelBaseUri.Scheme != Uri.UriSchemeHttps)
        {
            throw new InvalidOperationException("The model base URL must use HTTPS.");
        }
        if (modelSigningPublicKeyPath is not null)
        {
            var applicationDirectory = Path.TrimEndingDirectorySeparator(
                Path.GetFullPath(AppContext.BaseDirectory));
            var keyDirectory = Path.TrimEndingDirectorySeparator(
                Path.GetDirectoryName(modelSigningPublicKeyPath) ?? string.Empty);
            if (!string.Equals(applicationDirectory, keyDirectory, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The model signing public key must be beside the companion executable.");
            }
        }

        if (origins.Count == 0)
        {
            origins.Add("http://localhost:3000");
        }

        return new CompanionOptions
        {
            DataDirectory = dataDirectory,
            WorkerEndpoint = worker,
            AllowedOrigins = origins.Distinct(StringComparer.Ordinal).ToArray(),
            WorkerExecutable = workerExecutable,
            ModelBaseUri = modelBaseUri,
            ModelSigningPublicKeyPath = modelSigningPublicKeyPath,
            RotatePairing = rotate,
            RotatePairingOnly = rotateOnly,
            AuthorizeModelInstallOnly = authorizeModelInstallOnly,
        };
    }
}

internal sealed class WorkerAccessToken
{
    public string Value { get; } =
        Environment.GetEnvironmentVariable("SPEAKINGLAB_WORKER_TOKEN")
        ?? Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
}

internal sealed class WorkerProcessHost : BackgroundService
{
    private readonly CompanionOptions _options;
    private readonly WorkerAccessToken _accessToken;
    private readonly ModelPackageManager _models;
    private readonly object _gate = new();
    private Process? _process;

    public WorkerProcessHost(
        CompanionOptions options,
        WorkerAccessToken accessToken,
        ModelPackageManager models)
    {
        _options = options;
        _accessToken = accessToken;
        _models = models;
    }

    public bool IsRunning
    {
        get
        {
            lock (_gate)
            {
                return string.IsNullOrWhiteSpace(_options.WorkerExecutable) ||
                    _process is { HasExited: false };
            }
        }
    }

    public void RequestRestart()
    {
        lock (_gate)
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
            }
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_options.WorkerExecutable))
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            lock (_gate)
            {
                if (_process is null || _process.HasExited)
                {
                    StartWorker();
                }
            }

            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }

    private void StartWorker()
    {
        if (!File.Exists(_options.WorkerExecutable))
        {
            throw new FileNotFoundException("The packaged local voice worker is missing.");
        }

        _process?.Dispose();
        var modelDirectory = Path.Combine(_options.DataDirectory, "models");
        Directory.CreateDirectory(modelDirectory);
        var start = new ProcessStartInfo
        {
            FileName = _options.WorkerExecutable,
            WorkingDirectory = Path.GetDirectoryName(_options.WorkerExecutable)!,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = false,
            RedirectStandardOutput = false,
        };
        start.Environment["HF_HOME"] = modelDirectory;
        start.Environment["PYTHONUTF8"] = "1";
        start.Environment["SPEAKINGLAB_WORKER_TOKEN"] = _accessToken.Value;
        start.Environment["SPEAKINGLAB_MODEL_PATH"] = _models.ActiveModelPath;
        start.Environment["SPEAKINGLAB_VOICES_PATH"] = _models.ActiveVoicesPath;
        _process = Process.Start(start)
            ?? throw new InvalidOperationException("The local voice worker could not be started.");
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit(5_000);
            }
        }
        await base.StopAsync(cancellationToken);
    }
}

internal sealed class ModelPackageManager
{
    private const long MaxManifestBytes = 256 * 1024;
    private const long MaxModelBytes = 512L * 1024 * 1024;
    private static readonly TimeSpan StallTimeout = TimeSpan.FromSeconds(12);
    private static readonly TimeSpan WholeInstallTimeout = TimeSpan.FromMinutes(10);
    private readonly CompanionOptions _options;
    private readonly SemaphoreSlim _installGate = new(1, 1);
    private readonly HttpClient _http = new(new HttpClientHandler
    {
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.None,
    })
    {
        Timeout = Timeout.InfiniteTimeSpan,
    };
    private readonly string _modelsRoot;
    private readonly string _activeDirectory;
    private volatile string _phase = "idle";
    private long _receivedBytes;
    private long _expectedBytes;

    public ModelPackageManager(CompanionOptions options)
    {
        _options = options;
        _modelsRoot = Path.Combine(options.DataDirectory, "models");
        _activeDirectory = Path.Combine(_modelsRoot, "active");
    }

    public string ActiveModelPath => Path.Combine(_activeDirectory, "model.onnx");
    public string ActiveVoicesPath => Path.Combine(_activeDirectory, "voices.bin");

    public object GetStatus()
    {
        var installed =
            File.Exists(ActiveModelPath) &&
            File.Exists(ActiveVoicesPath);
        string? release = null;
        try
        {
            release = File.ReadAllText(Path.Combine(_activeDirectory, "release.txt")).Trim();
        }
        catch (IOException)
        {
            // A missing release marker means the package is not considered complete.
            installed = false;
        }

        return new
        {
            configured = _options.ModelBaseUri is not null &&
                !string.IsNullOrWhiteSpace(_options.ModelSigningPublicKeyPath),
            installed,
            release = installed ? release : null,
            installing = _installGate.CurrentCount == 0,
            phase = _phase,
            receivedBytes = Interlocked.Read(ref _receivedBytes),
            expectedBytes = Interlocked.Read(ref _expectedBytes),
        };
    }

    public async Task<object> InstallAsync(CancellationToken ct)
    {
        if (_options.ModelBaseUri is null ||
            string.IsNullOrWhiteSpace(_options.ModelSigningPublicKeyPath) ||
            !File.Exists(_options.ModelSigningPublicKeyPath))
        {
            throw new InvalidOperationException(
                "Signed model installation is not configured for this companion release.");
        }

        if (!await _installGate.WaitAsync(0, ct))
        {
            throw new InvalidOperationException("A model installation is already running.");
        }

        using var installDeadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        installDeadline.CancelAfter(WholeInstallTimeout);
        var installCt = installDeadline.Token;
        try
        {
            _phase = "verifying-manifest";
            Interlocked.Exchange(ref _receivedBytes, 0);
            Interlocked.Exchange(ref _expectedBytes, 0);
            var manifestBytes = await DownloadSmallAsync(
                new Uri(_options.ModelBaseUri, "manifest.json"),
                MaxManifestBytes,
                installCt);
            var signature = await DownloadSmallAsync(
                new Uri(_options.ModelBaseUri, "manifest.sig"),
                16 * 1024,
                installCt);
            VerifyManifestSignature(
                manifestBytes,
                signature,
                _options.ModelSigningPublicKeyPath);
            installCt.ThrowIfCancellationRequested();

            var manifest = JsonSerializer.Deserialize<ModelManifest>(
                manifestBytes,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidOperationException("The signed model manifest is invalid.");
            ValidateManifest(manifest);
            installCt.ThrowIfCancellationRequested();

            Directory.CreateDirectory(_modelsRoot);
            var stagingDirectory = Path.Combine(
                _modelsRoot,
                $".download-{manifest.Release.ToLowerInvariant()}");
            CleanupStaleDownloadDirectories(stagingDirectory);
            EnsureSafeStagingDirectory(stagingDirectory);

            Interlocked.Exchange(
                ref _expectedBytes,
                manifest.Files.Sum(file => file.Bytes));
            long completedBytes = 0;
            foreach (var file in manifest.Files)
            {
                var name = file.Path.EndsWith("/model.onnx", StringComparison.Ordinal)
                    ? "model.onnx"
                    : file.Path.EndsWith("/voices.bin", StringComparison.Ordinal)
                        ? "voices.bin"
                        : throw new InvalidOperationException(
                            "The signed model manifest contains an unsupported file.");
                _phase = name == "model.onnx" ? "downloading-model" : "downloading-voices";
                completedBytes += await DownloadAndVerifyAsync(
                    new Uri(_options.ModelBaseUri, file.Path),
                    Path.Combine(stagingDirectory, name),
                    file.Bytes,
                    file.Sha256,
                    completedBytes,
                    installCt);
            }

            _phase = "activating";
            await File.WriteAllTextAsync(
                Path.Combine(stagingDirectory, "release.txt"),
                manifest.Release,
                installCt);
            installCt.ThrowIfCancellationRequested();
            Activate(stagingDirectory);
            _phase = "installed";
            return new
            {
                installed = true,
                release = manifest.Release,
                modelId = manifest.ModelId,
            };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            _phase = "paused";
            throw;
        }
        catch (OperationCanceledException error)
        {
            _phase = "paused";
            throw new InvalidOperationException(
                "The model download reached its absolute time limit and was paused.",
                error);
        }
        catch (InvalidOperationException)
        {
            _phase = "failed";
            throw;
        }
        catch (Exception error) when (
            error is HttpRequestException or
            IOException or
            JsonException or
            CryptographicException)
        {
            _phase = "failed";
            throw new InvalidOperationException(
                "The signed model package could not be downloaded or verified.",
                error);
        }
        finally
        {
            _installGate.Release();
        }
    }

    private void CleanupStaleDownloadDirectories(string retainedDirectory)
    {
        if (!Directory.Exists(_modelsRoot)) return;
        var retained = Path.TrimEndingDirectorySeparator(
            Path.GetFullPath(retainedDirectory));
        foreach (var candidatePath in Directory.EnumerateDirectories(
            _modelsRoot,
            ".download-*",
            SearchOption.TopDirectoryOnly))
        {
            var candidate = Path.TrimEndingDirectorySeparator(
                Path.GetFullPath(candidatePath));
            if (string.Equals(candidate, retained, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            var relative = Path.GetRelativePath(_modelsRoot, candidate);
            if (Path.IsPathRooted(relative) ||
                relative.StartsWith("..", StringComparison.Ordinal) ||
                !Path.GetFileName(candidate).StartsWith(".download-", StringComparison.Ordinal))
            {
                continue;
            }
            try
            {
                DeleteDirectoryWithoutFollowingReparsePoints(new DirectoryInfo(candidate));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // Cleanup is best effort. The selected release still installs
                // into its own verified directory and never reuses this path.
            }
        }
    }

    private void EnsureSafeStagingDirectory(string stagingDirectory)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(stagingDirectory));
        var relative = Path.GetRelativePath(_modelsRoot, full);
        if (Path.IsPathRooted(relative) ||
            relative.StartsWith("..", StringComparison.Ordinal) ||
            !Path.GetFileName(full).StartsWith(".download-", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("The model staging directory is invalid.");
        }
        var directory = new DirectoryInfo(full);
        if (directory.Exists &&
            directory.Attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            throw new InvalidOperationException("The model staging directory cannot be a reparse point.");
        }
        directory.Create();
    }

    private static void DeleteDirectoryWithoutFollowingReparsePoints(
        DirectoryInfo directory)
    {
        if (!directory.Exists) return;
        if (directory.Attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            directory.Delete(recursive: false);
            return;
        }
        foreach (var child in directory.EnumerateDirectories())
        {
            DeleteDirectoryWithoutFollowingReparsePoints(child);
        }
        foreach (var file in directory.EnumerateFiles())
        {
            if (file.IsReadOnly) file.IsReadOnly = false;
            file.Delete();
        }
        directory.Delete(recursive: false);
    }

    private async Task<byte[]> DownloadSmallAsync(
        Uri uri,
        long maximumBytes,
        CancellationToken ct)
    {
        using var response = await _http.GetAsync(
            uri,
            HttpCompletionOption.ResponseHeadersRead,
            ct);
        if (response.StatusCode != HttpStatusCode.OK ||
            response.Content.Headers.ContentLength is > 0 &&
            response.Content.Headers.ContentLength > maximumBytes)
        {
            throw new InvalidOperationException("The signed model catalog response is invalid.");
        }
        await using var source = await response.Content.ReadAsStreamAsync(ct);
        using var destination = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var count = await ReadWithStallAsync(source, buffer, ct);
            if (count == 0) break;
            if (destination.Length + count > maximumBytes)
            {
                throw new InvalidOperationException("The signed model catalog is too large.");
            }
            await destination.WriteAsync(buffer.AsMemory(0, count), ct);
        }
        return destination.ToArray();
    }

    private static void VerifyManifestSignature(
        byte[] manifest,
        byte[] signature,
        string publicKeyPath)
    {
        var publicKey = File.ReadAllText(publicKeyPath);
        using var verifier = ECDsa.Create();
        verifier.ImportFromPem(publicKey);
        if (!verifier.VerifyData(
            manifest,
            signature,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence))
        {
            throw new InvalidOperationException("The model manifest signature is invalid.");
        }
    }

    private static void ValidateManifest(ModelManifest manifest)
    {
        if (manifest.SchemaVersion != 1 ||
            manifest.ModelId != "kokoro-82m-v1.0-onnx" ||
            string.IsNullOrWhiteSpace(manifest.Release) ||
            manifest.Release.Length != 40 ||
            !manifest.Release.All(Uri.IsHexDigit) ||
            manifest.Files is null ||
            manifest.Files.Count != 2)
        {
            throw new InvalidOperationException("The signed model manifest is not supported.");
        }

        var expectedPrefix = $"releases/{manifest.Release}/";
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in manifest.Files)
        {
            if (!file.Path.StartsWith(expectedPrefix, StringComparison.Ordinal) ||
                file.Path.Contains('\\') ||
                file.Path.Contains("..", StringComparison.Ordinal) ||
                file.Bytes is <= 0 or > MaxModelBytes ||
                file.Sha256.Length != 64 ||
                !file.Sha256.All(Uri.IsHexDigit))
            {
                throw new InvalidOperationException("The signed model manifest contains an invalid file.");
            }
            names.Add(file.Path[expectedPrefix.Length..]);
        }
        if (!names.SetEquals(["model.onnx", "voices.bin"]))
        {
            throw new InvalidOperationException("The signed model package is incomplete.");
        }
    }

    private async Task<long> DownloadAndVerifyAsync(
        Uri uri,
        string destinationPath,
        long expectedBytes,
        string expectedSha256,
        long completedBefore,
        CancellationToken ct)
    {
        await using var destination = new FileStream(
            destinationPath,
            FileMode.OpenOrCreate,
            FileAccess.ReadWrite,
            FileShare.None,
            1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var existingBytes = destination.Length;
        if (existingBytes > expectedBytes)
        {
            destination.SetLength(0);
            existingBytes = 0;
            Interlocked.Exchange(ref _receivedBytes, completedBefore);
        }

        using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[1024 * 1024];
        destination.Position = 0;
        long hashed = 0;
        while (hashed < existingBytes)
        {
            var count = await destination.ReadAsync(
                buffer.AsMemory(0, (int)Math.Min(buffer.Length, existingBytes - hashed)),
                ct);
            if (count == 0) throw new InvalidOperationException("A partial model file is unreadable.");
            digest.AppendData(buffer, 0, count);
            hashed += count;
        }
        Interlocked.Exchange(ref _receivedBytes, completedBefore + existingBytes);

        if (existingBytes == expectedBytes)
        {
            var existingDigest = Convert.ToHexString(digest.GetHashAndReset());
            if (CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(expectedSha256),
                Convert.FromHexString(existingDigest)))
            {
                return expectedBytes;
            }
            destination.SetLength(0);
            existingBytes = 0;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        if (existingBytes > 0)
        {
            request.Headers.Range = new RangeHeaderValue(existingBytes, null);
        }
        using var response = await _http.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            ct);
        if (existingBytes > 0)
        {
            var range = response.Content.Headers.ContentRange;
            if (response.StatusCode != HttpStatusCode.PartialContent ||
                range?.From != existingBytes ||
                range.Length != expectedBytes)
            {
                throw new InvalidOperationException("The model host did not honor the resumable range request.");
            }
        }
        else if (response.StatusCode != HttpStatusCode.OK)
        {
            throw new InvalidOperationException("A signed model file response is invalid.");
        }
        if (response.Content.Headers.ContentLength is long length &&
            length != expectedBytes - existingBytes)
        {
            throw new InvalidOperationException("A signed model file response has the wrong size.");
        }

        await using var source = await response.Content.ReadAsStreamAsync(ct);
        destination.Position = existingBytes;
        long received = existingBytes;
        while (true)
        {
            var count = await ReadWithStallAsync(source, buffer, ct);
            if (count == 0) break;
            received += count;
            if (received > expectedBytes)
            {
                throw new InvalidOperationException("A signed model file exceeded its declared size.");
            }
            digest.AppendData(buffer, 0, count);
            await destination.WriteAsync(buffer.AsMemory(0, count), ct);
            Interlocked.Exchange(ref _receivedBytes, completedBefore + received);
        }
        await destination.FlushAsync(ct);
        var actualDigest = Convert.ToHexString(digest.GetHashAndReset());
        if (received != expectedBytes ||
            !CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(expectedSha256),
                Convert.FromHexString(actualDigest)))
        {
            throw new InvalidOperationException("A signed model file failed SHA-256 verification.");
        }
        return expectedBytes;
    }

    private static async Task<int> ReadWithStallAsync(
        Stream source,
        Memory<byte> buffer,
        CancellationToken ct)
    {
        using var stall = CancellationTokenSource.CreateLinkedTokenSource(ct);
        stall.CancelAfter(StallTimeout);
        try
        {
            return await source.ReadAsync(buffer, stall.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new InvalidOperationException(
                "The model download made no progress for 12 seconds and was paused.");
        }
    }

    private void Activate(string stagingDirectory)
    {
        var backupDirectory = Path.Combine(_modelsRoot, ".previous");
        if (Directory.Exists(backupDirectory))
        {
            Directory.Delete(backupDirectory, recursive: true);
        }
        if (Directory.Exists(_activeDirectory))
        {
            Directory.Move(_activeDirectory, backupDirectory);
        }
        try
        {
            Directory.Move(stagingDirectory, _activeDirectory);
        }
        catch
        {
            if (!Directory.Exists(_activeDirectory) &&
                Directory.Exists(backupDirectory))
            {
                Directory.Move(backupDirectory, _activeDirectory);
            }
            throw;
        }
        if (Directory.Exists(backupDirectory))
        {
            Directory.Delete(backupDirectory, recursive: true);
        }
    }

    private sealed record ModelManifest(
        int SchemaVersion,
        string Release,
        string ModelId,
        List<ModelManifestFile> Files);

    private sealed record ModelManifestFile(
        string Path,
        long Bytes,
        string Sha256);
}

internal sealed class PairingStore
{
    private readonly string _path;
    private readonly object _gate = new();
    private PairingState _state;

    public PairingStore(CompanionOptions options)
    {
        _path = Path.Combine(options.DataDirectory, "pairing.json");
        _state = Load(_path);
    }

    public bool HasBootstrapCode => !string.IsNullOrWhiteSpace(_state.BootstrapDigest);
    public bool HasIssuedToken
    {
        get
        {
            lock (_gate)
            {
                _state = Load(_path);
                if (PruneExpiredTokens(DateTimeOffset.UtcNow))
                {
                    Save();
                }
                return _state.TokenDigests.Count > 0;
            }
        }
    }

    public string RotateBootstrapCode()
    {
        lock (_gate)
        {
            var code = RandomNumberGenerator.GetInt32(100_000, 1_000_000).ToString();
            _state = _state with
            {
                BootstrapDigest = Digest(code),
                BootstrapExpiresAt = DateTimeOffset.UtcNow.AddMinutes(15),
            };
            Save();
            return code;
        }
    }

    public string RotateModelInstallCode()
    {
        lock (_gate)
        {
            _state = Load(_path);
            var code = RandomNumberGenerator.GetInt32(100_000, 1_000_000).ToString();
            _state = _state with
            {
                ModelInstallDigest = Digest(code),
                ModelInstallExpiresAt = DateTimeOffset.UtcNow.AddMinutes(15),
            };
            Save();
            return code;
        }
    }

    public bool ValidateModelInstallCode(string code, string origin)
    {
        if (string.IsNullOrWhiteSpace(origin))
        {
            return false;
        }
        lock (_gate)
        {
            _state = Load(_path);
            if (_state.ModelInstallExpiresAt < DateTimeOffset.UtcNow ||
                string.IsNullOrWhiteSpace(_state.ModelInstallDigest) ||
                !FixedTimeEquals(_state.ModelInstallDigest, Digest(code)))
            {
                return false;
            }
            return true;
        }
    }

    public void InvalidateModelInstallCode(string code)
    {
        lock (_gate)
        {
            _state = Load(_path);
            if (!string.IsNullOrWhiteSpace(_state.ModelInstallDigest) &&
                FixedTimeEquals(_state.ModelInstallDigest, Digest(code)))
            {
                _state = _state with
                {
                    ModelInstallDigest = null,
                    ModelInstallExpiresAt = null,
                };
                Save();
            }
        }
    }

    public string? ExchangeBootstrapCode(string code, string origin)
    {
        lock (_gate)
        {
            // An administrator can rotate the code with the CLI while the
            // service remains up. Reload makes that change visible atomically.
            _state = Load(_path);
            if (_state.BootstrapExpiresAt < DateTimeOffset.UtcNow ||
                string.IsNullOrWhiteSpace(_state.BootstrapDigest) ||
                !FixedTimeEquals(_state.BootstrapDigest, Digest(code)))
            {
                return null;
            }

            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
            var digest = Digest(token);
            _state.TokenDigests.RemoveAll(item => item.ExpiresAt <= DateTimeOffset.UtcNow);
            _state.TokenDigests.Add(new TokenDigest(
                digest,
                DateTimeOffset.UtcNow.AddDays(180),
                origin));
            _state = _state with { BootstrapDigest = null, BootstrapExpiresAt = null };
            Save();
            return token;
        }
    }

    public bool ValidateToken(string token, string origin)
    {
        if (token.Length is < 32 or > 128)
        {
            return false;
        }

        var digest = Digest(token);
        lock (_gate)
        {
            _state = Load(_path);
            var pruned = PruneExpiredTokens(DateTimeOffset.UtcNow);
            var valid = _state.TokenDigests.Any(item =>
                item.ExpiresAt > DateTimeOffset.UtcNow &&
                string.Equals(item.Origin, origin, StringComparison.Ordinal) &&
                FixedTimeEquals(item.Digest, digest));
            if (pruned)
            {
                Save();
            }
            return valid;
        }
    }

    public void RevokeToken(string token, string origin)
    {
        if (token.Length is < 32 or > 128 || string.IsNullOrWhiteSpace(origin))
        {
            return;
        }
        var digest = Digest(token);
        lock (_gate)
        {
            _state = Load(_path);
            var changed = PruneExpiredTokens(DateTimeOffset.UtcNow);
            changed |= _state.TokenDigests.RemoveAll(item =>
                string.Equals(item.Origin, origin, StringComparison.Ordinal) &&
                FixedTimeEquals(item.Digest, digest)) > 0;
            if (changed)
            {
                Save();
            }
        }
    }

    private bool PruneExpiredTokens(DateTimeOffset now) =>
        _state.TokenDigests.RemoveAll(item => item.ExpiresAt <= now) > 0;

    private static PairingState Load(string path)
    {
        try
        {
            return JsonSerializer.Deserialize<PairingState>(File.ReadAllText(path))
                ?? PairingState.Empty;
        }
        catch (FileNotFoundException)
        {
            return PairingState.Empty;
        }
        catch (JsonException)
        {
            throw new InvalidOperationException("The pairing state is corrupted; rotate pairing as an administrator.");
        }
    }

    private void Save()
    {
        var temporary = _path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(_state));
        File.Move(temporary, _path, true);
    }

    private static string Digest(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static bool FixedTimeEquals(string expected, string actual) =>
        CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(expected),
            Convert.FromHexString(actual));

    private sealed record PairingState(
        string? BootstrapDigest,
        DateTimeOffset? BootstrapExpiresAt,
        string? ModelInstallDigest,
        DateTimeOffset? ModelInstallExpiresAt,
        List<TokenDigest> TokenDigests)
    {
        public static PairingState Empty { get; } = new(null, null, null, null, []);
    }

    private sealed record TokenDigest(
        string Digest,
        DateTimeOffset ExpiresAt,
        string? Origin);
}

internal sealed class PairingRateLimiter
{
    private readonly object _gate = new();
    private readonly Queue<DateTimeOffset> _attempts = new();

    public bool TryAcquire(IPAddress? remoteAddress)
    {
        if (remoteAddress is not null && !IPAddress.IsLoopback(remoteAddress))
        {
            return false;
        }

        lock (_gate)
        {
            var threshold = DateTimeOffset.UtcNow.AddMinutes(-1);
            while (_attempts.TryPeek(out var oldest) && oldest < threshold)
            {
                _attempts.Dequeue();
            }
            if (_attempts.Count >= 10)
            {
                return false;
            }
            _attempts.Enqueue(DateTimeOffset.UtcNow);
            return true;
        }
    }
}

internal sealed class LocalWorkerClient
{
    private const int MaxAudioBytes = 16 * 1024 * 1024;
    private readonly HttpClient _http;
    private readonly Uri _baseUri;
    private readonly WorkerAccessToken _accessToken;
    private readonly SemaphoreSlim _speechSlots = new(2, 2);

    public LocalWorkerClient(
        HttpClient http,
        CompanionOptions options,
        WorkerAccessToken accessToken)
    {
        _http = http;
        _baseUri = options.WorkerEndpoint;
        _accessToken = accessToken;
    }

    public async Task<WorkerHealth> GetHealthAsync(CancellationToken ct)
    {
        try
        {
            using var request = CreateRequest(HttpMethod.Get, "/health");
            using var response = await _http.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                ct);
            if (!response.IsSuccessStatusCode)
            {
                return new WorkerHealth(false, false);
            }
            var json = await response.Content.ReadAsByteArrayAsync(ct);
            if (json.Length > 16 * 1024)
            {
                return new WorkerHealth(false, false);
            }
            using var document = JsonDocument.Parse(json);
            var modelInstalled =
                document.RootElement.TryGetProperty("modelInstalled", out var value) &&
                value.ValueKind == JsonValueKind.True;
            return new WorkerHealth(true, modelInstalled);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            return new WorkerHealth(false, false);
        }
    }

    public sealed record WorkerHealth(bool Reachable, bool ModelInstalled);

    public async Task<IResult> ProxyJsonAsync(string path, CancellationToken ct)
    {
        var requestId = Guid.NewGuid().ToString("N");
        try
        {
            using var upstreamRequest = CreateRequest(HttpMethod.Get, path);
            using var response = await _http.SendAsync(
                upstreamRequest,
                HttpCompletionOption.ResponseHeadersRead,
                ct);
            if (!response.IsSuccessStatusCode)
            {
                return WorkerFailure(requestId, response.StatusCode);
            }

            var json = await response.Content.ReadAsStringAsync(ct);
            using var parsed = JsonDocument.Parse(json);
            return Results.Json(parsed.RootElement.Clone());
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            return Results.Json(
                new { error = "local_worker_unavailable", requestId },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    public async Task<IResult> StreamSpeechAsync(SpeechRequest speech, CancellationToken ct)
    {
        var requestId = Guid.NewGuid().ToString("N");
        if (!await _speechSlots.WaitAsync(0, ct))
        {
            return Results.Json(
                new { error = "local_companion_busy", requestId },
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        try
        {
            using var upstreamRequest = CreateRequest(HttpMethod.Post, "/v1/audio/speech");
            upstreamRequest.Content = JsonContent.Create(new
            {
                input = speech.Input,
                model = speech.Model,
                voice = speech.Voice,
                speed = speech.Speed,
                response_format = speech.ResponseFormat,
            });
            using var response = await _http.SendAsync(
                upstreamRequest,
                HttpCompletionOption.ResponseHeadersRead,
                ct);
            if (!response.IsSuccessStatusCode)
            {
                return WorkerFailure(requestId, response.StatusCode);
            }

            var mediaType = response.Content.Headers.ContentType?.MediaType ?? "application/octet-stream";
            if (response.Content.Headers.ContentLength is > MaxAudioBytes)
            {
                return Results.Json(
                    new { error = "local_worker_response_too_large", requestId },
                    statusCode: StatusCodes.Status502BadGateway);
            }

            var audio = await response.Content.ReadAsByteArrayAsync(ct);
            if (audio.Length > MaxAudioBytes)
            {
                return Results.Json(
                    new { error = "local_worker_response_too_large", requestId },
                    statusCode: StatusCodes.Status502BadGateway);
            }
            return Results.Bytes(audio, mediaType);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            return Results.Json(
                new { error = "local_worker_unavailable", requestId },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        finally
        {
            _speechSlots.Release();
        }
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, new Uri(_baseUri, path));
        request.Headers.Add("X-SpeakingLab-Worker-Token", _accessToken.Value);
        return request;
    }

    private static IResult WorkerFailure(string requestId, HttpStatusCode status) =>
        Results.Json(
            new
            {
                error = "local_worker_failed",
                requestId,
                upstreamStatus = (int)status,
            },
            statusCode: StatusCodes.Status502BadGateway);
}
