module github.com/hippoley/flythink-kontxt-interop

go 1.26.1

require (
	github.com/aramase/kontxt v0.0.0
	github.com/golang-jwt/jwt/v5 v5.3.1
)

require github.com/google/uuid v1.6.0 // indirect

replace github.com/aramase/kontxt => ../../_kontxt
