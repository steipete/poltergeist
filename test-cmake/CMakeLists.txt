cmake_minimum_required(VERSION 3.14)
project(TestProject)

add_executable(test-app main.cpp)
add_library(test-lib STATIC lib.cpp)
